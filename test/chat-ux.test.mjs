import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../src/config.mjs';
import { Bridge } from '../src/bridge.mjs';
import { normalizePhoton, replyInfo, mediaKind } from '../src/photon-adapter.mjs';

async function setup(extra = {}) {
  const stateDir = await fs.mkdtemp(path.join(root, 'test', '.state-'));
  const runs = [], events = [], sent = []; let n = 0, sessionCounter = 0;
  const mcp = { ready: true, close() {},
    run: async (prompt, sid) => { events.push('run'); runs.push({ prompt, sid }); return { sessionId: sid || 'ses_' + (++sessionCounter), text: 'Answer to: ' + prompt.split('\n').pop() }; },
    ...extra.mcp };
  const bridge = new Bridge({ mcp, allowedSenders: new Set(['+1 555 010 0199']), stateDir, typingMs: 15, busyWaitMs: 5, busyTries: 3 });
  const typing = { start: async () => { events.push('typing-start'); }, stop: async () => { events.push('typing-stop'); } };
  const msg = (text, o = {}) => ({ senderId: '+15550100199', spaceId: 'dm', messageId: 'm' + (++n), text, isDirect: true, typing, markRead: async () => { events.push('read'); },
    reply: async t => { sent.push(t); const id = 'out' + sent.length; events.push('send'); return id; }, ...o });
  return { bridge, runs, events, sent, msg, cleanup: () => fs.rm(stateDir, { recursive: true, force: true }) };
}

test('no "passing to Aside" message: the only text sent is the answer', async () => {
  const f = await setup();
  try { await f.bridge.handle(f.msg('Open example.com')); assert.deepEqual(f.sent, ['Answer to: Open example.com']); } finally { await f.cleanup(); }
});
test('read receipt, then typing starts when Aside starts and stops when it finishes', async () => {
  const f = await setup();
  try {
    await f.bridge.handle(f.msg('Task'));
    assert.deepEqual(f.events.filter(e => e !== 'send'), ['read', 'typing-start', 'run', 'typing-stop']);
  } finally { await f.cleanup(); }
});
test('typing is refreshed during long tasks and always stopped, even on errors', async () => {
  const f = await setup({ mcp: { run: async () => { await new Promise(r => setTimeout(r, 70)); throw new Error('boom'); } } });
  try {
    await f.bridge.handle(f.msg('Slow task'));
    assert.ok(f.events.filter(e => e === 'typing-start').length >= 3);
    assert.equal(f.events.at(-1) === 'send' ? f.events.at(-2) : f.events.at(-1), 'typing-stop');
  } finally { await f.cleanup(); }
});
test('typing failures never break the task', async () => {
  const f = await setup();
  try {
    const m = f.msg('Task'); m.typing = { start: async () => { throw new Error('x'); }, stop: async () => { throw new Error('y'); } };
    await f.bridge.handle(m); assert.equal(f.runs.length, 1); assert.equal(f.sent.length, 1);
  } finally { await f.cleanup(); }
});
test('swipe-reply to an older answer continues THAT conversation, plain messages continue the latest', async () => {
  const f = await setup();
  try {
    await f.bridge.handle(f.msg('Topic A'));          // ses_1, answer id out1
    await f.bridge.handle(f.msg('/new Topic B'));     // ses_2, answer id out3 (after /new notice)
    await f.bridge.handle(f.msg('Follow up on A', { replyTo: 'out1' }));
    assert.equal(f.runs.at(-1).sid, 'ses_1');
    await f.bridge.handle(f.msg('Plain next message'));
    assert.equal(f.runs.at(-1).sid, 'ses_1'); // the conversation you last used
    await f.bridge.handle(f.msg('/new Topic C')); await f.bridge.handle(f.msg('Back to A', { replyTo: 'out1' }));
    assert.equal(f.runs.at(-1).sid, 'ses_1');
  } finally { await f.cleanup(); }
});
test('swipe-reply mapping survives a restart', async () => {
  const f = await setup();
  try {
    await f.bridge.handle(f.msg('Topic A')); await f.bridge.handle(f.msg('/new Topic B'));
    f.bridge.loaded = false; await f.bridge.load();
    await f.bridge.handle(f.msg('More on A', { replyTo: 'out1' })); assert.equal(f.runs.at(-1).sid, 'ses_1');
  } finally { await f.cleanup(); }
});
test('swipe-reply to an unknown message adds the quoted text as context; commands ignore replyTo', async () => {
  const f = await setup();
  try {
    await f.bridge.handle(f.msg('Do it', { replyTo: 'unknown-id', quoted: 'Buy "milk"\n\n tomorrow' }));
    assert.match(f.runs[0].prompt, /^\(I am replying to this earlier message: "Buy 'milk' tomorrow"\)\n\nDo it$/);
    await f.bridge.handle(f.msg('/status', { replyTo: 'out1' })); assert.equal(f.runs.length, 1);
  } finally { await f.cleanup(); }
});
test('photos and files get a clear text-only answer; strangers stay silent', async () => {
  const f = await setup();
  try {
    await f.bridge.handle(f.msg('', { unsupported: 'attachment' }));
    assert.deepEqual(f.sent, ['I cannot read that kind of attachment. Please send photos, videos, voice messages or text.']); assert.equal(f.runs.length, 0);
    const before = f.sent.length;
    await f.bridge.handle(f.msg('', { unsupported: 'attachment', senderId: '+15550001111' })); assert.equal(f.sent.length, before);
  } finally { await f.cleanup(); }
});
test('same number written differently or an email in different case is still the owner', async () => {
  const f = await setup(); f.bridge.allowedSenders.add('Me@Example.com');
  try {
    await f.bridge.handle(f.msg('Hello', { senderId: '+1 555 010-0199' })); assert.equal(f.runs.length, 1);
    await f.bridge.handle(f.msg('Hello 2', { senderId: 'me@example.COM' })); assert.equal(f.runs.length, 2);
    await f.bridge.handle(f.msg('Hello 3', { senderId: '+15550100198' })); assert.equal(f.runs.length, 2);
  } finally { await f.cleanup(); }
});
test('a second message while a task runs is told it is queued, and then runs', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const f = await setup({ mcp: { run: async (p, sid) => { await gate; return { sessionId: sid || 'ses_1', text: 'ok' }; } } });
  try {
    const first = f.bridge.handle(f.msg('First')); await new Promise(r => setTimeout(r, 20));
    const second = f.bridge.handle(f.msg('Second')); await new Promise(r => setTimeout(r, 20));
    assert.ok(f.sent.includes('Queued. I will start after the current task.'));
    release(); await Promise.all([first, second]); assert.equal(f.sent.filter(t => t === 'ok').length, 2);
  } finally { await f.cleanup(); }
});
test('a conversation that is still running elsewhere is reported, not silently waited on', async () => {
  let status = 'running';
  const f = await setup({ mcp: { sessionInfo: async () => ({ status }) } });
  try {
    await f.bridge.handle(f.msg('Start'));                    // first run has no session to check
    assert.equal(f.runs.length, 1);
    await f.bridge.handle(f.msg('Follow up'));
    assert.equal(f.runs.length, 1); assert.match(f.sent.at(-1), /still busy in Aside/);
    status = 'idle'; await f.bridge.handle(f.msg('Follow up again')); assert.equal(f.runs.length, 2);
  } finally { await f.cleanup(); }
});
test('a session that finishes within a few seconds is waited for', async () => {
  let calls = 0;
  const f = await setup({ mcp: { sessionInfo: async () => ({ status: ++calls < 2 ? 'running' : 'idle' }) } });
  try { await f.bridge.handle(f.msg('Start')); await f.bridge.handle(f.msg('Next')); assert.equal(f.runs.length, 2); } finally { await f.cleanup(); }
});

test('adapter: native reply info, media detection, ids, typing and read', async () => {
  const target = { id: 'guid-1', content: { type: 'text', text: 'Earlier answer' } };
  assert.deepEqual(replyInfo({ type: 'reply', target, content: { type: 'text', text: 'Why?' } }), { replyTo: 'guid-1', quoted: 'Earlier answer' });
  assert.deepEqual(replyInfo({ type: 'text', text: 'x' }), {});
  assert.equal(mediaKind({ type: 'reply', content: { type: 'group', items: [{ type: 'text', text: 'hi' }, { type: 'contact' }] } }), 'contact');
  assert.equal(mediaKind({ type: 'reaction' }), undefined);
  const calls = [];
  const space = { id: 'chat', send: async t => ({ id: 'sent-1', t }), startTyping: async () => calls.push('start'), stopTyping: async () => calls.push('stop'), read: async () => calls.push('read') };
  const message = { id: 'in-1', platform: 'imessage', direction: 'inbound', sender: { id: '+1' }, content: { type: 'reply', target, content: { type: 'text', text: 'Why?' } } };
  const ev = normalizePhoton(space, message, () => ({ type: 'dm' }));
  assert.equal(ev.replyTo, 'guid-1'); assert.equal(ev.text, 'Why?');
  assert.equal(await ev.reply('answer'), 'sent-1');
  await ev.typing.start(); await ev.typing.stop(); await ev.markRead(); assert.deepEqual(calls, ['start', 'stop', 'read']);
  const card = normalizePhoton(space, { ...message, content: { type: 'contact' } }, () => ({ type: 'dm' }));
  assert.equal(card.unsupported, 'contact'); assert.equal(card.text, '');
  const photo = normalizePhoton(space, { ...message, content: { type: 'attachment', name: 'a.heic', mimeType: 'image/heic', size: 3, read: async () => Buffer.from('abc') } }, () => ({ type: 'dm' }));
  assert.equal(photo.unsupported, undefined); assert.equal(photo.media.length, 1); assert.equal((await photo.media[0].read()).toString(), 'abc');
  assert.equal(normalizePhoton(space, { ...message, content: { type: 'reaction' } }, () => ({ type: 'dm' })), undefined);
});
