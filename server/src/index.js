import { config } from './config.js';
import { createApp } from './app.js';
import { seedIfEmpty } from './db/seed.js';
import { closeDb } from './db/connection.js';
import { aiStatus } from './ai/llmClient.js';

if (seedIfEmpty()) console.log('[db] empty database seeded with sample data');

const server = createApp().listen(config.port, () => {
  const ai = aiStatus();
  console.log(`[server] listening on http://localhost:${config.port}`);
  console.log(`[ai] ${ai.enabled ? `enabled (triage: ${config.ai.classifierModel}, drafts: ${config.ai.draftModel})` : 'disabled: GROQ_API_KEY not set, using rule-based triage and manual replies'}`);
});

function shutdown() {
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // SSE connections keep the server open; force-close after a grace period.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
