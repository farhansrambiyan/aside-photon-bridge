import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { root } from './config.mjs';

const run = (cmd, args, { timeout = 180000, env = {} } = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout, env: { ...process.env, ...env }, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => error ? reject(new Error('command failed')) : resolve(String(stdout)));
});
// iMessage voice notes are .caf. Convert with the Mac's own tool when the first try fails.
function withWavFallback(exec, tmpDir, attempt) {
  return async file => {
    try { return await attempt(file); } catch (first) {
      const wav = path.join(tmpDir, path.basename(file) + '.16k.wav');
      try {
        await exec('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', file, wav], { timeout: 60000 });
        return await attempt(wav);
      } catch { throw first; } finally { await fsp.unlink(wav).catch(() => {}); }
    }
  };
}

export function localBackend(cfg, exec = run) {
  const site = path.join(root, 'voice', 'site'), models = path.join(root, 'voice', 'models'), script = path.join(root, 'scripts', 'transcribe.py');
  if (!cfg.voicePython || !fs.existsSync(cfg.voicePython) || !fs.existsSync(site)) return null;
  return withWavFallback(exec, cfg.mediaDir, async file => {
    const out = await exec(cfg.voicePython, [script, file], { env: { PYTHONPATH: site, HF_HOME: models, VOICE_MODEL_DIR: models, VOICE_MODEL: cfg.voiceModel, VOICE_LANGUAGE: cfg.voiceLanguage, HF_HUB_DISABLE_TELEMETRY: '1' } });
    return JSON.parse(out.trim().split('\n').pop()).text;
  });
}
// Any OpenAI-compatible /audio/transcriptions service (Groq has a free tier). Audio leaves this Mac.
export function apiBackend(cfg, exec = run, fetchImpl = fetch) {
  if (!cfg.voiceApiKey) return null;
  return withWavFallback(exec, cfg.mediaDir, async file => {
    const form = new FormData();
    form.append('file', new Blob([await fsp.readFile(file)]), path.basename(file));
    form.append('model', cfg.voiceApiModel); form.append('response_format', 'json');
    if (cfg.voiceLanguage) form.append('language', cfg.voiceLanguage);
    const res = await fetchImpl(`${cfg.voiceApiUrl.replace(/\/+$/, '')}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.voiceApiKey}` }, body: form, signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error('transcription service error');
    return (await res.json()).text;
  });
}
// VOICE_COMMAND="whisper-cli -m /path/model.bin -nt -f {file}": any program that prints the text. No shell.
export function commandBackend(cfg, exec = run) {
  const parts = String(cfg.voiceCommand || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length || !parts.includes('{file}')) return null;
  return withWavFallback(exec, cfg.mediaDir, async file => (await exec(parts[0], parts.slice(1).map(p => p === '{file}' ? file : p))).trim());
}
export function createTranscriber(cfg, deps = {}) {
  const order = cfg.voiceBackend === 'off' ? [] : cfg.voiceBackend === 'auto' ? ['local', 'api', 'command'] : [cfg.voiceBackend];
  const makers = { local: localBackend, api: apiBackend, command: commandBackend };
  for (const name of order) {
    const backend = makers[name]?.(cfg, deps.exec, deps.fetch);
    if (backend) return { name, transcribe: async file => backend(file) };
  }
  return null;
}
