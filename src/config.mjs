import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function config(env = process.env) {
  const split = value => new Set((value || '').split(',').map(s => s.trim()).filter(Boolean));
  const timeoutMs = Number(env.ASIDE_TIMEOUT_MS || 1200000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3600000) throw new Error('ASIDE_TIMEOUT_MS must be 1000–3600000.');
  const account = env.ASIDE_ACCOUNT || 'u0';
  if (!/^u\d+$/.test(account)) throw new Error('ASIDE_ACCOUNT must be an account ID such as u0.');
  return {
    cli: env.ASIDE_CLI || path.join(root, 'bin', 'aside'), account, timeoutMs,
    allowedSenders: split(env.ALLOWED_SENDERS), allowedSpaces: split(env.ALLOWED_SPACES),
    projectId: env.SPECTRUM_PROJECT_ID || '', projectSecret: env.SPECTRUM_PROJECT_SECRET || '',
    stateDir: path.join(root, 'state'),
  };
}
