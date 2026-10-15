// Thin fetch wrapper. The session lives in an httpOnly cookie, so no token handling here.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'XMLHttpRequest', // required by the API's CSRF check
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? 'Request failed. Please try again.', err?.details);
  }
  return data;
}

const qs = (params) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
};

export const api = {
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/auth/me'),

  books: () => request('GET', '/books'),

  tickets: (filters = {}) => request('GET', `/tickets${qs(filters)}`),
  ticket: (id) => request('GET', `/tickets/${id}`),
  createTicket: (input) => request('POST', '/tickets', input),
  updateTicket: (id, patch) => request('PATCH', `/tickets/${id}`, patch),
  sendMessage: (id, input) => request('POST', `/tickets/${id}/messages`, input),
  addNote: (id, body) => request('POST', `/tickets/${id}/notes`, { body }),
  aiDraft: (id, regenerate = false) => request('GET', `/tickets/${id}/ai-draft${qs({ regenerate: regenerate || undefined })}`),
  retriage: (id) => request('POST', `/tickets/${id}/triage`),

  team: () => request('GET', '/admin/team'),
  stats: () => request('GET', '/admin/stats'),
  meta: () => request('GET', '/admin/meta'),
};
