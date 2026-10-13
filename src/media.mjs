import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/quicktime': 'mov', 'video/mp4': 'mp4', 'video/x-m4v': 'm4v', 'audio/x-caf': 'caf', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/amr': 'amr', 'application/pdf': 'pdf' };
const LABEL = { voice: 'voice message', image: 'photo', video: 'video', file: 'file' };
export const kindOf = item => item.type === 'voice' ? 'voice' : /^image\//i.test(item.mimeType || '') ? 'image' : /^video\//i.test(item.mimeType || '') ? 'video' : 'file';
const safeName = name => String(name || '').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60);
const extFor = item => EXT[String(item.mimeType || '').toLowerCase()] || (path.extname(String(item.name || '')).slice(1).toLowerCase().match(/^[a-z0-9]{1,5}$/)?.[0]) || 'bin';
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref?.())]);

// Saves what you send to a private folder. Photos, videos and files are handed to Aside
// as file paths (Aside does the rest). Voice messages are turned into text first.
export class MediaStore {
  constructor({ dir, maxBytes = 100 * 1048576, keepDays = 3, transcribe = null, readTimeoutMs = 120000, maxItems = 6, now = () => Date.now() }) {
    Object.assign(this, { dir, maxBytes, keepDays, transcribe, readTimeoutMs, maxItems, now });
  }
  async init() { await fs.mkdir(this.dir, { recursive: true, mode: 0o700 }); }
  // Old attachments are deleted so photos and voice notes do not pile up on disk.
  async cleanup() {
    try {
      const cutoff = this.now() - this.keepDays * 86400000;
      for (const name of await fs.readdir(this.dir)) {
        const file = path.join(this.dir, name);
        const stat = await fs.lstat(file).catch(() => null);
        if (stat?.isFile() && stat.mtimeMs < cutoff) await fs.unlink(file).catch(() => {});
      }
    } catch { /* folder may not exist yet */ }
  }
  async handle(items) {
    const result = { lines: [], heard: [], problems: [] };
    await this.init();
    const problem = text => { if (!result.problems.includes(text)) result.problems.push(text); };
    if (items.length > this.maxItems) problem(`Only the first ${this.maxItems} attachments were read.`);
    for (const item of items.slice(0, this.maxItems)) {
      const kind = kindOf(item), label = LABEL[kind], limitMb = Math.round(this.maxBytes / 1048576);
      if (item.size && item.size > this.maxBytes) { problem(`A ${label} was too large (${Math.round(item.size / 1048576)} MB, the limit is ${limitMb} MB).`); continue; }
      let buffer;
      try { buffer = await withTimeout(Promise.resolve().then(() => item.read()), this.readTimeoutMs); } catch { problem(`I could not download a ${label}.`); continue; }
      if (!buffer?.length) { problem(`A ${label} was empty.`); continue; }
      if (buffer.length > this.maxBytes) { problem(`A ${label} was too large (the limit is ${limitMb} MB).`); continue; }
      // Our own file name: never trust the sender's name for a path.
      const stamp = new Date(this.now()).toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const file = path.join(this.dir, `${stamp}-${randomBytes(3).toString('hex')}.${extFor(item)}`);
      await fs.writeFile(file, buffer, { mode: 0o600 });
      if (kind === 'voice') {
        if (!this.transcribe) { problem('Voice messages need transcription, which is not set up on the Mac yet (run npm run setup-voice).'); continue; }
        try {
          const text = String(await this.transcribe(file) || '').replace(/\s+/g, ' ').trim();
          if (text) result.heard.push(text); else problem('I could not hear any speech in a voice message.');
        } catch { problem('I could not transcribe a voice message.'); }
        continue;
      }
      const name = kind === 'file' ? ` "${safeName(item.name) || 'attachment'}"` : '';
      result.lines.push(`- ${kind === 'image' ? 'Photo' : kind === 'video' ? 'Video' : 'File'}${name}: ${file}`);
    }
    return result;
  }
}

// What Aside receives: the user's words (voice becomes text) plus the saved file paths.
export function composeMediaPrompt(userText, { lines, heard, problems }) {
  const text = [userText, ...heard].map(s => String(s || '').trim()).filter(Boolean).join('\n');
  if (!lines.length && !text) return '';
  const parts = [];
  if (lines.length) parts.push(`[The user attached files to this message. They are saved on this Mac at these paths. Open them with your file tools to look at them.]\n${lines.join('\n')}\n[End of attached files]`);
  if (problems.length) parts.push(`[Note: ${problems.join(' ')}]`);
  parts.push(text || 'The user sent no message with the attachment. Look at it, say what it is, and suggest the obvious next step.');
  return parts.join('\n\n');
}
