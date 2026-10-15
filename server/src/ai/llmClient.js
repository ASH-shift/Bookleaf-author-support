import Groq, {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  RateLimitError,
} from 'groq-sdk';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';

// A small circuit breaker: after repeated failures we stop calling the API for a cool-down
// period, so an outage doesn't add a long timeout to every ticket.
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;
let consecutiveFailures = 0;
let breakerOpenUntil = 0;

let client;
function getClient() {
  if (!client) {
    client = new Groq({
      apiKey: config.ai.apiKey, // read from the environment only; never sent to the browser
      timeout: config.ai.timeoutMs,
      maxRetries: 2, // SDK retries 408/409/429/5xx with backoff
    });
  }
  return client;
}

export function aiStatus() {
  if (!config.ai.apiKey) return { enabled: false, reason: 'not_configured' };
  if (Date.now() < breakerOpenUntil) return { enabled: false, reason: 'temporarily_unavailable' };
  return { enabled: true };
}

function errorCode(err) {
  if (err instanceof RateLimitError) return 'rate_limited';
  if (err instanceof AuthenticationError) return 'auth_error';
  if (err instanceof BadRequestError) return 'bad_request';
  if (err instanceof APIConnectionTimeoutError) return 'timeout';
  if (err instanceof APIConnectionError) return 'connection_error';
  if (err instanceof APIError) return `api_error_${err.status ?? 'unknown'}`;
  return 'unexpected_error';
}

function logUsage({ ticketId, operation, model, usage, latencyMs, success, error }) {
  try {
    getDb().prepare(`
      INSERT INTO ai_usage (ticket_id, operation, model, input_tokens, output_tokens,
        cache_read_tokens, latency_ms, success, error_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      ticketId ?? null, operation, model,
      usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0,
      usage?.prompt_tokens_details?.cached_tokens ?? 0,
      latencyMs, success ? 1 : 0, error ?? null
    );
  } catch (err) {
    console.error('[ai] failed to log usage', err.message);
  }
}

/**
 * Calls the LLM (Groq chat completions) and never throws.
 * Returns { ok: true, text } or { ok: false, error }. Callers decide how to degrade.
 */
export async function callLLM({ operation, ticketId, model, messages, maxTokens, reasoningEffort = 'low', responseFormat }) {
  const status = aiStatus();
  if (!status.enabled) return { ok: false, error: status.reason };

  const started = Date.now();
  try {
    const response = await getClient().chat.completions.create({
      model,
      messages,
      max_completion_tokens: maxTokens,
      reasoning_effort: reasoningEffort,
      include_reasoning: false, // we only need the final answer; keeps responses small
      ...(responseFormat ? { response_format: responseFormat } : {}),
    });

    const choice = response.choices?.[0];
    if (choice?.finish_reason === 'length') throw Object.assign(new Error('truncated'), { code: 'truncated' });
    const text = choice?.message?.content?.trim();
    if (!text) throw Object.assign(new Error('empty'), { code: 'empty_output' });

    consecutiveFailures = 0;
    logUsage({ ticketId, operation, model, usage: response.usage, latencyMs: Date.now() - started, success: true });
    return { ok: true, text };
  } catch (err) {
    const code = ['truncated', 'empty_output'].includes(err.code) ? err.code : errorCode(err);
    // Only infrastructure failures trip the breaker, not a single odd response.
    if (!['truncated', 'empty_output', 'bad_request'].includes(code)) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= BREAKER_THRESHOLD) {
        breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
        consecutiveFailures = 0;
      }
    }
    // Log the code only: error messages can echo request content.
    console.warn(`[ai] ${operation} failed for ticket ${ticketId ?? '-'}: ${code}`);
    logUsage({ ticketId, operation, model, latencyMs: Date.now() - started, success: false, error: code });
    return { ok: false, error: code };
  }
}
