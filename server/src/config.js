import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (isProduction) {
    // Refuse to boot with a weak or missing secret in production.
    throw new Error('JWT_SECRET must be set to at least 32 characters in production.');
  }
  // Dev/test: an ephemeral random secret. Sessions reset on restart, which is fine locally.
  return crypto.randomBytes(48).toString('hex');
}

export const config = Object.freeze({
  isProduction,
  isTest,
  port: Number(process.env.PORT) || 4000,
  jwtSecret: resolveJwtSecret(),
  sessionTtlSeconds: 60 * 60 * 8, // 8 hours
  cookieName: 'bl_session',
  databasePath: isTest
    ? ':memory:'
    : path.resolve(serverRoot, process.env.DATABASE_PATH || './data/bookleaf.db'),
  sampleDataPath: path.resolve(serverRoot, 'data/bookleaf_sample_data.json'),
  clientDistPath: path.resolve(serverRoot, '../client/dist'),
  ai: {
    apiKey: process.env.GROQ_API_KEY || null,
    classifierModel: process.env.AI_CLASSIFIER_MODEL || 'openai/gpt-oss-20b',
    draftModel: process.env.AI_DRAFT_MODEL || 'openai/gpt-oss-120b',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 20000,
  },
  seed: {
    authorPassword: process.env.SEED_AUTHOR_PASSWORD || 'Author@123',
    adminPassword: process.env.SEED_ADMIN_PASSWORD || 'Admin@123',
  },
});
