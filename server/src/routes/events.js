import { Router } from 'express';
import { ROLES } from '../constants.js';
import { subscribeTicketEvents } from '../services/eventBus.js';

const router = Router();
const HEARTBEAT_MS = 25_000;

// Server-Sent Events stream. Admins receive every ticket event; authors only events for
// their own tickets. Payloads carry ids only — clients refetch via the authorized REST API.
router.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering (nginx/Render)
  });
  res.write('retry: 5000\n\n');

  const { role, author_id: authorId } = req.user;
  const unsubscribe = subscribeTicketEvents((event) => {
    if (role !== ROLES.ADMIN && event.authorId !== authorId) return;
    res.write(`event: ticket\ndata: ${JSON.stringify({ type: event.type, ticketId: event.ticketId })}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
