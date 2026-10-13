import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../src/config.mjs';
import { Bridge, splitReply } from '../src/bridge.mjs';

async function fixture() {
  const stateDir = await fs.mkdtemp(path.join(root, 'test', '.state-'));
  const calls = [], replies = [];
  const mcp = { ready: true, run: async (prompt, sessionId) => { calls.push({ prompt, sessionId }); return { sessionId: 'ses_test', text: 'Browser result' }; }, close() {} };
  const bridge = new Bridge({ mcp, allowedSenders: new Set(['owner']), stateDir });
  let n = 0;
  const message = (extra = {}) => ({ senderId: 'owner', spaceId: 'dm-1', messageId: String(++n), text: '/aside check page', isDirect: true, reply: async text => replies.push(text), ...extra });
  return { bridge, calls, replies, stateDir, message, cleanup: () => fs.rm(stateDir, { recursive: true, force: true }) };
}

test('ignores unknown senders, groups, missing IDs, and empty text', async () => {
  const f = await fixture();
  try {
    for (const extra of [{ senderId: 'stranger' }, { isDirect: false }, { messageId: '' }, { text: '   ' }]) assert.equal((await f.bridge.handle(f.message(extra))).ignored, true);
    assert.equal(f.calls.length, 0); assert.equal(f.replies.length, 0);
  } finally { await f.cleanup(); }
});
test('forwards prompt without shell interpolation and resumes saved session', async () => {
  const f = await fixture();
  try {
    const literal = 'Find "deals"; $(touch /tmp/nope) --permission full-access';
    await f.bridge.handle(f.message({ text: '/aside ' + literal }));
    await f.bridge.handle(f.message({ text: '/aside continue' }));
    assert.equal(f.calls[0].prompt, literal); assert.equal(f.calls[1].sessionId, 'ses_test');
    assert.equal(f.replies.at(-1), 'Browser result');
    assert.equal((await fs.stat(path.join(f.stateDir, 'sessions.json'))).mode & 0o777, 0o600);
  } finally { await f.cleanup(); }
});
test('deduplicates messages, including after process restart', async () => {
  const f = await fixture();
  try {
    const message = f.message(); await f.bridge.handle(message);
    assert.equal((await f.bridge.handle(message)).duplicate, true);
    f.bridge.loaded = false; await f.bridge.load();
    assert.equal((await f.bridge.handle(message)).duplicate, true); assert.equal(f.calls.length, 1);
  } finally { await f.cleanup(); }
});
test('new resets only this chat session; status/help do not execute', async () => {
  const f = await fixture();
  try {
    await f.bridge.handle(f.message());
    for (const text of ['/aside status', '/aside help', '/aside new']) await f.bridge.handle(f.message({ text }));
    await f.bridge.handle(f.message());
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].sessionId, undefined);
  } finally { await f.cleanup(); }
});
test('serializes concurrent tasks so the second uses the first session', async () => {
  const f = await fixture();
  try {
    await Promise.all([f.bridge.handle(f.message()), f.bridge.handle(f.message())]);
    assert.equal(f.calls[1].sessionId, 'ses_test');
  } finally { await f.cleanup(); }
});
test('space allowlist and sender-specific sessions', async () => {
  const f = await fixture();
  try {
    f.bridge.allowedSpaces = new Set(['dm-1']);
    assert.equal((await f.bridge.handle(f.message({ spaceId: 'dm-2' }))).ignored, true);
    await f.bridge.handle(f.message());
    f.bridge.allowedSenders.add('owner-2');
    await f.bridge.handle(f.message({ senderId: 'owner-2' }));
    assert.equal(f.calls[1].sessionId, undefined);
  } finally { await f.cleanup(); }
});
test('errors do not retry browser side effects', async () => {
  const f = await fixture();
  try {
    f.bridge.mcp.run = async () => { throw new Error('Test failure'); };
    const message = f.message(); assert.equal((await f.bridge.handle(message)).success, false);
    assert.equal((await f.bridge.handle(message)).duplicate, true);
    assert.match(f.replies.at(-1), /avoid repeating/);
  } finally { await f.cleanup(); }
});
test('reply splitter preserves unicode and bounds output', () => {
  assert.equal(splitReply('hello', 3).join(''), 'hello');
  assert.equal(splitReply('😀😀😀', 2).join(''), '😀😀😀');
  assert.equal(splitReply('a'.repeat(30000)).length, 9);
});

test('nonboolean directness fails closed', async () => {
  const f = await fixture();
  try { assert.equal((await f.bridge.handle(f.message({ isDirect: 'false' }))).ignored, true); }
  finally { await f.cleanup(); }
});
test('uncertain task failure persists pause and stops later tasks', async () => {
  const f = await fixture();
  try {
    f.bridge.mcp.run = async () => { const e = new Error('timed out'); e.mayHaveRun = true; throw e; };
    await f.bridge.handle(f.message());
    assert.equal((await f.bridge.handle(f.message())).blocked, true);
    f.bridge.loaded = false; await f.bridge.load(); assert.equal(f.bridge.state.blocked, true);
  } finally { await f.cleanup(); }
});

test('ordinary text starts and continues the same conversation', async () => {
  const f = await fixture();
  try {
    await f.bridge.handle(f.message({ text: 'Open example.com' }));
    await f.bridge.handle(f.message({ text: 'Check that page again' }));
    assert.deepEqual(f.calls, [{ prompt: 'Open example.com', sessionId: undefined }, { prompt: 'Check that page again', sessionId: 'ses_test' }]);
    assert.equal(f.bridge.state.inFlight, false);
  } finally { await f.cleanup(); }
});
test('/new resets this conversation and /new task starts immediately', async () => {
  const f = await fixture();
  try {
    await f.bridge.handle(f.message({ text: 'Task one' }));
    await f.bridge.handle(f.message({ text: '/new' }));
    await f.bridge.handle(f.message({ text: 'Task two' }));
    await f.bridge.handle(f.message({ text: '/new Task three' }));
    assert.equal(f.calls.length, 3); assert.equal(f.calls[1].sessionId, undefined); assert.equal(f.calls[2].sessionId, undefined); assert.equal(f.calls[2].prompt, 'Task three');
  } finally { await f.cleanup(); }
});
test('bare words new/help/status are tasks, slash commands do not execute', async () => {
  const f = await fixture();
  try {
    for (const text of ['new', 'help', 'status']) await f.bridge.handle(f.message({ text }));
    for (const text of ['/status', '/help', '/unknown']) await f.bridge.handle(f.message({ text }));
    assert.deepEqual(f.calls.map(c => c.prompt), ['new', 'help', 'status']);
  } finally { await f.cleanup(); }
});
test('saved session continues after restart', async () => {
  const f = await fixture();
  try {
    await f.bridge.handle(f.message({ text: 'First task' })); f.bridge.loaded = false;
    await f.bridge.handle(f.message({ text: 'Follow up' })); assert.equal(f.calls[1].sessionId, 'ses_test');
  } finally { await f.cleanup(); }
});
test('crash during browser execution pauses subsequent tasks after restart', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.stateDir, 'sessions.json'), JSON.stringify({ sessions: {}, seen: [], inFlight: true, blocked: false }));
    assert.equal((await f.bridge.handle(f.message({ text: 'Next task' }))).blocked, true);
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});

test('outgoing reply is plain text while session stays saved for follow-up', async () => {
  const f = await fixture();
  try {
    f.bridge.mcp.run = async (prompt, sessionId) => { f.calls.push({ prompt, sessionId }); return { sessionId: 'ses_test', text: '# Done\n\n**session_id:** ses_test\n\n**Finished** [Page](https://example.com)' }; };
    await f.bridge.handle(f.message({ text: 'Task' }));
    assert.equal(f.replies.at(-1), 'Done\n\nFinished Page: https://example.com');
    await f.bridge.handle(f.message({ text: 'Continue' }));
    assert.equal(f.calls[1].sessionId, 'ses_test');
    assert.equal(f.replies.some(reply => reply.includes('ses_test')), false);
  } finally { await f.cleanup(); }
});

async function richFixture() {
  const f = await fixture();
  const now = Date.now();
  f.modelCalls = [];
  Object.assign(f.bridge.mcp, {
    listSessions: async () => [
      { id: 'ses_test', title: 'Check Flipkart orders', status: 'idle', updatedAt: new Date(now - 5 * 60000).toISOString() },
      { id: 'older_one', title: 'Who is **Sanjay**?', status: 'idle', updatedAt: new Date(now - 3 * 3600000).toISOString() },
      { id: 'busy_one', title: 'Long task', status: 'running', updatedAt: new Date(now).toISOString() },
    ],
    sessionInfo: async id => ({ id, title: id === 'older_one' ? 'Who is Sanjay?' : 'Other', status: id === 'busy_one' ? 'running' : 'idle' }),
    getDefaultModel: async () => ({ provider: 'claude-code', modelId: 'claude-opus-5-5' }),
    setModel: async (model, sessionId) => { f.modelCalls.push({ model, sessionId }); return { sessionUpdated: Boolean(sessionId) }; },
  });
  return f;
}
test('/sessions lists numbered sessions without exposing IDs and marks current', async () => {
  const f = await richFixture();
  try {
    await f.bridge.handle(f.message({ text: 'First task' }));
    await f.bridge.handle(f.message({ text: '/sessions' }));
    const out = f.replies.at(-1);
    assert.match(out, /1\. Check Flipkart orders \(5m ago\) \(current\)/);
    assert.match(out, /2\. Who is Sanjay\? \(3h ago\)/);
    assert.match(out, /3\. Long task \(just now, running\)/);
    assert.equal(out.includes('older_one') || out.includes('ses_test'), false);
    assert.equal(f.calls.length, 1);
  } finally { await f.cleanup(); }
});
test('/switch continues the chosen session, survives restart, and validates input', async () => {
  const f = await richFixture();
  try {
    await f.bridge.handle(f.message({ text: '/switch 2' }));
    assert.match(f.replies.at(-1), /\/sessions first/);
    await f.bridge.handle(f.message({ text: '/sessions' }));
    await f.bridge.handle(f.message({ text: '/switch 9' }));
    assert.match(f.replies.at(-1), /1 to 3/);
    const r = await f.bridge.handle(f.message({ text: '/switch 2' }));
    assert.equal(r.switched, true);
    assert.match(f.replies.at(-1), /Switched to: Who is Sanjay\?/);
    f.bridge.loaded = false;
    await f.bridge.handle(f.message({ text: 'Follow up there' }));
    assert.deepEqual(f.calls.at(-1), { prompt: 'Follow up there', sessionId: 'older_one' });
    await f.bridge.handle(f.message({ text: '/sessions' }));
    await f.bridge.handle(f.message({ text: '/switch 3' }));
    assert.match(f.replies.at(-1), /still running/);
  } finally { await f.cleanup(); }
});
test('/models lists catalog with current marked; /model switches by number or id', async () => {
  const f = await richFixture();
  try {
    await f.bridge.handle(f.message({ text: '/models' }));
    assert.match(f.replies.at(-1), /1\. Claude Opus 5\.5 \(current\)/);
    assert.match(f.replies.at(-1), /GPT-6\.1 Sol/);
    await f.bridge.handle(f.message({ text: '/model' }));
    assert.match(f.replies.at(-1), /Current model: Claude Opus 5\.5/);
    await f.bridge.handle(f.message({ text: '/model 15' }));
    assert.deepEqual(f.modelCalls[0], { model: { provider: 'aside', modelId: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }, sessionId: undefined });
    await f.bridge.handle(f.message({ text: 'Task' }));
    await f.bridge.handle(f.message({ text: '/model aside/grok-4.7' }));
    assert.equal(f.modelCalls[1].model.modelId, 'grok-4.7'); assert.equal(f.modelCalls[1].sessionId, 'ses_test');
    assert.match(f.replies.at(-1), /Switched to Grok 4\.7.*this conversation/);
    await f.bridge.handle(f.message({ text: '/model 999' }));
    assert.match(f.replies.at(-1), /could not find/);
    assert.equal(f.modelCalls.length, 2);
    assert.equal(f.calls.length, 1);
  } finally { await f.cleanup(); }
});
test('session/model command failures reply safely', async () => {
  const f = await richFixture();
  try {
    f.bridge.mcp.listSessions = async () => { throw new Error('/private/path leaked'); };
    f.bridge.mcp.setModel = async () => { throw new Error('Aside could not read sessions or models. Check the Aside app.'); };
    await f.bridge.handle(f.message({ text: '/sessions' }));
    assert.match(f.replies.at(-1), /unexpected local error/); assert.equal(f.replies.at(-1).includes('secret'), false);
    await f.bridge.handle(f.message({ text: '/model 1' }));
    assert.match(f.replies.at(-1), /Could not switch model: Aside could not read/);
  } finally { await f.cleanup(); }
});
