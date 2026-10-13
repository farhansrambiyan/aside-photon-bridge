import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../src/config.mjs';
import { MediaStore, composeMediaPrompt, kindOf } from '../src/media.mjs';
import { Bridge } from '../src/bridge.mjs';
import { createTranscriber } from '../src/transcribe.mjs';

const item = (type, mimeType, data = 'DATA', extra = {}) => ({ type, mimeType, name: 'IMG_0001.HEIC', size: data.length, read: async () => Buffer.from(data), ...extra });
async function tmp() { return fs.mkdtemp(path.join(root, 'test', '.state-')); }

test('kinds: voice notes, photos, videos, other files', () => {
  assert.equal(kindOf({ type: 'voice', mimeType: 'audio/x-caf' }), 'voice');
  assert.equal(kindOf({ type: 'attachment', mimeType: 'image/heic' }), 'image');
  assert.equal(kindOf({ type: 'attachment', mimeType: 'video/quicktime' }), 'video');
  assert.equal(kindOf({ type: 'attachment', mimeType: 'application/pdf' }), 'file');
});
test('photos and videos are saved privately and handed over by path', async () => {
  const dir = await tmp();
  try {
    const store = new MediaStore({ dir });
    const r = await store.handle([item('attachment', 'image/heic'), item('attachment', 'video/quicktime', 'VIDEO', { name: '../../evil.mov' })]);
    assert.equal(r.lines.length, 2); assert.equal(r.heard.length, 0); assert.deepEqual(r.problems, []);
    const [photo, video] = r.lines.map(l => l.replace(/^- \w+: /, ''));
    assert.match(r.lines[0], /^- Photo: /); assert.match(r.lines[1], /^- Video: /);
    assert.equal(path.dirname(photo), dir); assert.match(path.basename(photo), /^\d{14}-[0-9a-f]{6}\.heic$/); assert.match(video, /\.mov$/);
    assert.equal(await fs.readFile(photo, 'utf8'), 'DATA'); assert.equal((await fs.stat(photo)).mode & 0o777, 0o600);
    assert.equal(r.lines.join('').includes('evil'), false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('other files keep a sanitized label; the sender name never becomes a path', async () => {
  const dir = await tmp();
  try {
    const r = await new MediaStore({ dir }).handle([item('attachment', 'application/pdf', 'PDF', { name: 'Tax "return"; rm -rf.pdf' })]);
    assert.match(r.lines[0], /^- File "Tax _return__ rm -rf\.pdf": /); assert.match(r.lines[0], /\.pdf$/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('voice notes become text; without a transcriber the user is told how to set it up', async () => {
  const dir = await tmp(); const seen = [];
  try {
    let r = await new MediaStore({ dir, transcribe: async file => { seen.push(file); return '  remind me  tomorrow\n' ; } }).handle([item('voice', 'audio/x-caf')]);
    assert.deepEqual(r.heard, ['remind me tomorrow']); assert.deepEqual(r.lines, []); assert.match(seen[0], /\.caf$/);
    r = await new MediaStore({ dir }).handle([item('voice', 'audio/x-caf')]);
    assert.deepEqual(r.heard, []); assert.match(r.problems[0], /npm run setup-voice/);
    r = await new MediaStore({ dir, transcribe: async () => '' }).handle([item('voice', 'audio/x-caf')]); assert.match(r.problems[0], /could not hear any speech/);
    r = await new MediaStore({ dir, transcribe: async () => { throw new Error('boom /secret/path'); } }).handle([item('voice', 'audio/x-caf')]);
    assert.deepEqual(r.problems, ['I could not transcribe a voice message.']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('size limits, download failures, empty files and item caps', async () => {
  const dir = await tmp();
  try {
    const store = new MediaStore({ dir, maxBytes: 10, maxItems: 2 });
    let r = await store.handle([item('attachment', 'video/mp4', 'x', { size: 50 * 1048576 })]); assert.match(r.problems[0], /video was too large/);
    r = await store.handle([item('attachment', 'image/png', 'x'.repeat(11), { size: undefined })]); assert.match(r.problems[0], /photo was too large/);
    r = await store.handle([item('attachment', 'image/png', '', { read: async () => Buffer.alloc(0) })]); assert.match(r.problems[0], /empty/);
    r = await store.handle([{ type: 'attachment', mimeType: 'image/png', read: async () => { throw new Error('net'); } }]); assert.deepEqual(r.problems, ['I could not download a photo.']);
    r = await store.handle([item('attachment', 'image/png', 'a'), item('attachment', 'image/png', 'b'), item('attachment', 'image/png', 'c')]);
    assert.equal(r.lines.length, 2); assert.match(r.problems[0], /first 2 attachments/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('old attachments are cleaned up, new ones kept', async () => {
  const dir = await tmp();
  try {
    const store = new MediaStore({ dir, keepDays: 3 }); await store.init();
    await fs.writeFile(path.join(dir, 'old.jpg'), 'x'); await fs.writeFile(path.join(dir, 'new.jpg'), 'x');
    const old = new Date(Date.now() - 4 * 86400000); await fs.utimes(path.join(dir, 'old.jpg'), old, old);
    await store.cleanup(); assert.deepEqual(await fs.readdir(dir), ['new.jpg']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('prompt: paths + user words; voice text acts as typed text; empty cases', () => {
  const photo = { lines: ['- Photo: /m/a.jpg'], heard: [], problems: [] };
  assert.match(composeMediaPrompt('What is this?', photo), /^\[The user attached files[^\]]*\]\n- Photo: \/m\/a\.jpg\n\[End of attached files\]\n\nWhat is this\?$/);
  assert.match(composeMediaPrompt('', photo), /The user sent no message with the attachment/);
  assert.equal(composeMediaPrompt('', { lines: [], heard: ['check my email'], problems: [] }), 'check my email');
  assert.equal(composeMediaPrompt('Also', { lines: [], heard: ['check my email'], problems: [] }), 'Also\ncheck my email');
  assert.equal(composeMediaPrompt('', { lines: [], heard: [], problems: ['x'] }), '');
  assert.match(composeMediaPrompt('Hi', { lines: ['- Video: /m/v.mov'], heard: [], problems: ['A photo was empty.'] }), /\[Note: A photo was empty\.\]/);
});

async function bridgeSetup(media, extra = {}) {
  const stateDir = await tmp(); const runs = [], sent = [], events = []; let n = 0;
  const mcp = { ready: true, close() {}, run: async (prompt, sid) => { runs.push(prompt); return { sessionId: sid || 's1', text: 'done' }; } };
  const bridge = new Bridge({ mcp, allowedSenders: new Set(['+1']), stateDir, media, ...extra });
  const typing = { start: async () => events.push('typing-start'), stop: async () => events.push('typing-stop') };
  const msg = (text, o = {}) => ({ senderId: '+1', spaceId: 'dm', messageId: 'm' + (++n), text, isDirect: true, typing, reply: async t => { sent.push(t); events.push('send'); }, ...o });
  return { bridge, runs, sent, events, msg, dir: stateDir, cleanup: () => fs.rm(stateDir, { recursive: true, force: true }) };
}
test('chat: a photo with no text reaches Aside as a path plus a default request', async () => {
  const dir = await tmp();
  const f = await bridgeSetup(new MediaStore({ dir }));
  try {
    await f.bridge.handle(f.msg('', { media: [item('attachment', 'image/heic')] }));
    assert.equal(f.runs.length, 1); assert.match(f.runs[0], /- Photo: .*\.heic/); assert.match(f.runs[0], /Look at it, say what it is/);
    assert.deepEqual(f.sent, ['done']);
  } finally { await f.cleanup(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('chat: a video with a caption keeps the caption; typing shows while it is processed', async () => {
  const dir = await tmp();
  const f = await bridgeSetup(new MediaStore({ dir }));
  try {
    await f.bridge.handle(f.msg('Summarize this', { media: [item('attachment', 'video/quicktime', 'V')] }));
    assert.match(f.runs[0], /- Video: .*\.mov/); assert.match(f.runs[0], /Summarize this$/);
    assert.deepEqual(f.events.filter(e => e.startsWith('typing')).slice(0, 2), ['typing-start', 'typing-stop']);
  } finally { await f.cleanup(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('chat: a voice note is transcribed, echoed, and sent to Aside as if typed', async () => {
  const dir = await tmp();
  const f = await bridgeSetup(new MediaStore({ dir, transcribe: async () => 'check my email' }));
  try {
    await f.bridge.handle(f.msg('', { media: [item('voice', 'audio/x-caf')] }));
    assert.deepEqual(f.runs, ['check my email']); assert.deepEqual(f.sent, ['Heard: check my email', 'done']);
  } finally { await f.cleanup(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('chat: ECHO_TRANSCRIPT off hides the Heard line', async () => {
  const dir = await tmp();
  const f = await bridgeSetup(new MediaStore({ dir, transcribe: async () => 'hello there' }), { echoTranscript: false });
  try { await f.bridge.handle(f.msg('', { media: [item('voice', 'audio/x-caf')] })); assert.deepEqual(f.sent, ['done']); } finally { await f.cleanup(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('chat: a voice note with no transcriber runs nothing and explains why', async () => {
  const dir = await tmp();
  const f = await bridgeSetup(new MediaStore({ dir }));
  try { await f.bridge.handle(f.msg('', { media: [item('voice', 'audio/x-caf')] })); assert.equal(f.runs.length, 0); assert.match(f.sent[0], /npm run setup-voice/); } finally { await f.cleanup(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('chat: attachments on slash commands are ignored; no media support gives a clear note', async () => {
  const dir = await tmp();
  const f = await bridgeSetup(new MediaStore({ dir }));
  try { await f.bridge.handle(f.msg('/status', { media: [item('attachment', 'image/png')] })); assert.equal(f.runs.length, 0); assert.equal((await fs.readdir(dir)).length, 0); } finally { await f.cleanup(); await fs.rm(dir, { recursive: true, force: true }); }
  const g = await bridgeSetup(null);
  try { await g.bridge.handle(g.msg('', { media: [item('attachment', 'image/png')] })); assert.match(g.sent[0], /cannot read that kind of attachment/); assert.equal(g.runs.length, 0); } finally { await g.cleanup(); }
});
test('chat: strangers cannot make the bridge download anything', async () => {
  const dir = await tmp(); let downloads = 0;
  const f = await bridgeSetup(new MediaStore({ dir }));
  try {
    await f.bridge.handle(f.msg('', { senderId: '+999', media: [{ type: 'attachment', mimeType: 'image/png', read: async () => { downloads++; return Buffer.from('x'); } }] }));
    assert.equal(downloads, 0); assert.equal(f.sent.length, 0);
  } finally { await f.cleanup(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('transcriber: custom command (no shell), API, off, and wav fallback', async () => {
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, ...args]); if (cmd === 'fail-first' && args.at(-1).endsWith('.caf')) throw new Error('x'); return ' text from tool \n'; };
  const dir = await tmp();
  try {
    const base = { voiceBackend: 'auto', voiceCommand: 'my-stt --fast {file}', mediaDir: dir, voiceApiKey: '', voicePython: '', voiceApiUrl: 'https://api.example/v1/', voiceApiModel: 'm' };
    const cmd = createTranscriber(base, { exec }); assert.equal(cmd.name, 'command');
    assert.equal(await cmd.transcribe('/x/a.m4a'), 'text from tool'); assert.deepEqual(calls[0], ['my-stt', '--fast', '/x/a.m4a']);
    assert.equal(createTranscriber({ ...base, voiceBackend: 'off' }), null); assert.equal(createTranscriber({ ...base, voiceCommand: 'no-placeholder' }), null);
    const requests = [];
    const fetch = async (url, init) => { requests.push([url, init.headers.Authorization, init.body.get('model')]); return { ok: true, json: async () => ({ text: 'api text' }) }; };
    const api = createTranscriber({ ...base, voiceCommand: '', voiceApiKey: 'k' }, { exec, fetch }); assert.equal(api.name, 'api');
    await fs.writeFile(path.join(dir, 'v.m4a'), 'audio'); assert.equal(await api.transcribe(path.join(dir, 'v.m4a')), 'api text');
    assert.deepEqual(requests[0], ['https://api.example/v1/audio/transcriptions', 'Bearer k', 'm']);
    const fb = createTranscriber({ ...base, voiceCommand: 'fail-first {file}' }, { exec });
    await fs.writeFile(path.join(dir, 'v.caf'), 'audio'); calls.length = 0;
    assert.equal(await fb.transcribe(path.join(dir, 'v.caf')), 'text from tool');
    assert.equal(calls[1][0], '/usr/bin/afconvert'); assert.match(calls[2].at(-1), /\.16k\.wav$/);
    assert.equal((await fs.readdir(dir)).some(n => n.endsWith('.wav')), false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
