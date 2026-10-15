import { EventEmitter } from 'node:events';

// In-process pub/sub for real-time updates (single server instance).
// Events carry only ids, never ticket content: clients refetch through the normal
// authorized endpoints, so an event can never leak data the receiver isn't allowed to see.
const bus = new EventEmitter();
bus.setMaxListeners(0);

/** @param {{ type: string, ticketId: number, authorId: string }} event */
export function publishTicketEvent(event) {
  bus.emit('ticket', event);
}

export function subscribeTicketEvents(listener) {
  bus.on('ticket', listener);
  return () => bus.off('ticket', listener);
}
