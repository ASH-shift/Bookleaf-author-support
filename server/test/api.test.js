// End-to-end API tests against an in-memory database. AI is disabled (no API key),
// which also exercises the graceful-degradation path.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
delete process.env.GROQ_API_KEY;

const { createApp } = await import('../src/app.js');
const { seedIfEmpty } = await import('../src/db/seed.js');
const { closeDb } = await import('../src/db/connection.js');
const { config } = await import('../src/config.js');

let server;
let base;

before(async () => {
  seedIfEmpty();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  closeDb();
});

async function call(path, { method = 'GET', body, cookie, csrf = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf) headers['X-Requested-With'] = 'XMLHttpRequest';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function login(email, password) {
  const res = await call('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.headers.get('set-cookie').split(';')[0];
}

const authorLogin = (email) => login(email, config.seed.authorPassword);
const adminLogin = () => login('admin@bookleaf.example', config.seed.adminPassword);

test('login rejects wrong password with a generic message', async () => {
  const res = await call('/auth/login', { method: 'POST', body: { email: 'priya.sharma@email.com', password: 'wrong' } });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.message, 'Incorrect email or password');
});

test('session cookie is httpOnly and SameSite=Strict', async () => {
  const res = await call('/auth/login', { method: 'POST', body: { email: 'priya.sharma@email.com', password: config.seed.authorPassword } });
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.equal(res.body.user.password_hash, undefined);
});

test('validation errors return 400 with field details', async () => {
  const res = await call('/auth/login', { method: 'POST', body: { email: 'not-an-email' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'BAD_REQUEST');
  assert.ok(res.body.error.details.some((d) => d.field === 'email'));
});

test('state-changing requests without the CSRF header are rejected', async () => {
  const res = await call('/auth/login', { method: 'POST', body: {}, csrf: false });
  assert.equal(res.status, 403);
});

test('protected routes require authentication', async () => {
  for (const path of ['/tickets', '/books', '/admin/stats']) {
    assert.equal((await call(path)).status, 401, path);
  }
});

test('author sees only their own books, including in-production ones', async () => {
  const cookie = await authorLogin('kavita.deshmukh@email.com');
  const res = await call('/books?authorId=AUTH001', { cookie }); // authorId must be ignored
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((b) => b.id).sort(), ['BK015', 'BK016']);
  const inProduction = res.body.items.find((b) => b.id === 'BK015');
  assert.equal(inProduction.isPublished, false);
  assert.equal(inProduction.mrp, null);
});

test('author cannot read, update or reply to another author\'s ticket', async () => {
  const cookie = await authorLogin('ananya.reddy@email.com'); // AUTH003 owns demo ticket 1
  const other = 2; // owned by AUTH001
  assert.equal((await call(`/tickets/${other}`, { cookie })).status, 404);
  assert.equal((await call(`/tickets/${other}/messages`, { method: 'POST', cookie, body: { body: 'hello there' } })).status, 404);
  assert.equal((await call('/tickets/1', { method: 'PATCH', cookie, body: { status: 'Closed' } })).status, 403);
  assert.equal((await call('/tickets/1/notes', { method: 'POST', cookie, body: { body: 'sneaky' } })).status, 403);
  assert.equal((await call('/admin/stats', { cookie })).status, 403);
});

test('author cannot open a ticket against someone else\'s book', async () => {
  const cookie = await authorLogin('ananya.reddy@email.com');
  const res = await call('/tickets', {
    method: 'POST', cookie,
    body: { bookId: 'BK001', subject: 'Not my book', description: 'Trying to attach a book I do not own.' },
  });
  assert.equal(res.status, 400);
});

test('full ticket lifecycle works without AI (graceful degradation)', async () => {
  const author = await authorLogin('ananya.reddy@email.com');
  const admin = await adminLogin();

  // 1. Author creates a ticket; it is created even though AI is unavailable.
  const created = await call('/tickets', {
    method: 'POST', cookie: author,
    body: {
      bookId: 'BK005',
      subject: 'Book showing unavailable',
      description: 'My book is showing as Currently Unavailable on Amazon India since last week.',
      attachmentNames: ['screenshot.png'],
    },
  });
  assert.equal(created.status, 201);
  const id = created.body.ticket.id;
  assert.equal(created.body.ticket.priority, undefined, 'authors must not see priority');

  // 2. Rule-based triage runs in the background.
  await new Promise((r) => setTimeout(r, 50));
  let adminView = (await call(`/tickets/${id}`, { cookie: admin })).body.ticket;
  assert.equal(adminView.category, 'Distribution & Availability');
  assert.equal(adminView.categorySource, 'rules');
  assert.equal(adminView.triageState, 'fallback');

  // 3. Draft endpoint reports AI unavailable instead of failing.
  const draft = await call(`/tickets/${id}/ai-draft`, { cookie: admin });
  assert.equal(draft.status, 200);
  assert.equal(draft.body.available, false);

  // 4. Admin overrides priority, adds an internal note, replies manually.
  await call(`/tickets/${id}`, { method: 'PATCH', cookie: admin, body: { priority: 'Critical' } });
  await call(`/tickets/${id}/notes`, { method: 'POST', cookie: admin, body: { body: 'Checked stock sync logs.' } });
  const replied = await call(`/tickets/${id}/messages`, {
    method: 'POST', cookie: admin, body: { body: 'Hi Ananya, we have triggered a re-sync.', status: 'Resolved' },
  });
  assert.equal(replied.status, 201);
  adminView = replied.body.ticket;
  assert.equal(adminView.priority, 'Critical');
  assert.equal(adminView.prioritySource, 'admin');
  assert.equal(adminView.status, 'Resolved');
  assert.equal(adminView.assignedTo.name, 'Neha (Support Lead)', 'replying claims the ticket');

  // 5. Re-running triage must not overwrite the admin's override.
  await call(`/tickets/${id}/triage`, { method: 'POST', cookie: admin });
  assert.equal((await call(`/tickets/${id}`, { cookie: admin })).body.ticket.priority, 'Critical');

  // 6. Author sees the reply but none of the internal fields.
  const authorView = (await call(`/tickets/${id}`, { cookie: author })).body.ticket;
  assert.equal(authorView.messages.length, 1);
  assert.equal(authorView.messages[0].from, 'support');
  for (const field of ['notes', 'priority', 'aiDraft', 'aiReasoning', 'assignedTo']) {
    assert.equal(authorView[field], undefined, `author view leaked ${field}`);
  }

  // 7. Author follow-up reopens a resolved ticket; closed tickets refuse follow-ups.
  const followUp = await call(`/tickets/${id}/messages`, { method: 'POST', cookie: author, body: { body: 'Still not visible.' } });
  assert.equal(followUp.body.ticket.status, 'Open');
  await call(`/tickets/${id}`, { method: 'PATCH', cookie: admin, body: { status: 'Closed' } });
  const closed = await call(`/tickets/${id}/messages`, { method: 'POST', cookie: author, body: { body: 'Hello?' } });
  assert.equal(closed.status, 409);
});

test('admin queue filters and puts urgent, oldest tickets first', async () => {
  const admin = await adminLogin();
  const res = await call('/tickets?status=active', { cookie: admin });
  assert.equal(res.status, 200);
  const ranks = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const order = res.body.items.map((t) => ranks[t.priority]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));

  const filtered = await call('/tickets?category=ISBN%20%26%20Metadata%20Issues', { cookie: admin });
  assert.ok(filtered.body.items.every((t) => t.category === 'ISBN & Metadata Issues'));

  assert.equal((await call('/tickets?priority=Urgent', { cookie: admin })).status, 400);
});

test('unknown API routes return a JSON 404', async () => {
  const res = await call('/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});
