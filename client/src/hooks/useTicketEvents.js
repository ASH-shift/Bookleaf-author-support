import { useEffect, useRef, useState } from 'react';

/**
 * Subscribes to the server's ticket event stream (SSE). Calls onEvent({ type, ticketId })
 * whenever a visible ticket changes; the caller refetches what it needs.
 * EventSource reconnects automatically; we also refetch when the tab regains focus.
 */
export function useTicketEvents(onEvent) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource('/api/events', { withCredentials: true });
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener('ticket', (e) => {
      try { handler.current(JSON.parse(e.data)); } catch { /* ignore malformed event */ }
    });
    const onFocus = () => handler.current({ type: 'focus' });
    window.addEventListener('focus', onFocus);
    return () => {
      source.close();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return connected;
}
