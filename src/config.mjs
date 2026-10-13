import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function setting(value, fallback, min, max) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Assistant setting must be an integer from ${min} to ${max}.`);
  return n;
}
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
    mediaDir: path.resolve(env.MEDIA_DIR || path.join(root, 'media')),
    mediaMaxMb: setting(env.MEDIA_MAX_MB, 100, 1, 500),
    mediaKeepDays: setting(env.MEDIA_KEEP_DAYS, 3, 1, 90),
    echoTranscript: env.ECHO_TRANSCRIPT !== 'off',
    voiceBackend: ['auto', 'local', 'api', 'command', 'off'].includes(env.VOICE_BACKEND) ? env.VOICE_BACKEND : 'auto',
    voicePython: env.VOICE_PYTHON || (() => { try { return fs.readFileSync(path.join(root, 'voice', 'python'), 'utf8').trim(); } catch { return ''; } })(),
    voiceModel: env.VOICE_MODEL || 'small',
    voiceLanguage: /^[a-z]{2,3}$/i.test(env.VOICE_LANGUAGE || '') ? env.VOICE_LANGUAGE : '',
    voiceApiUrl: env.VOICE_API_URL || 'https://api.groq.com/openai/v1',
    voiceApiKey: env.VOICE_API_KEY || '',
    voiceApiModel: env.VOICE_API_MODEL || 'whisper-large-v3-turbo',
    voiceCommand: env.VOICE_COMMAND || '',
    timeZone: env.ASSISTANT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
    googleAccount: env.GOOGLE_ACCOUNT || '',
    watchIntervalMin: setting(env.EMAIL_CHECK_MINUTES, 5, 2, 720),
    gmailUid: setting(env.GMAIL_UID, 0, 0, 20),
    emailMode: env.EMAIL_FILTER === 'rules' ? 'rules' : 'ai',
    watchStart: setting(env.EMAIL_CHECK_START_HOUR, 8, 0, 23),
    watchEnd: setting(env.EMAIL_CHECK_END_HOUR, 22, 1, 24),
    briefingTime: !env.BRIEFING_TIME ? null : (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(env.BRIEFING_TIME) ? env.BRIEFING_TIME : null),
  };
}
