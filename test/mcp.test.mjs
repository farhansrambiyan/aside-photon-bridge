import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { root } from '../src/config.mjs';
import { AsideMCP } from '../src/mcp.mjs';
const make = () => new AsideMCP({ cli: process.execPath, args: [path.join(root, 'test/fake-mcp.mjs')], timeoutMs: 100 });
test('MCP transport initializes and parses exec response', async () => {
  const client = make();
  try { assert.deepEqual(await client.run('literal ; $(echo hi)', 'old-session'), { sessionId: 'session-123', text: 'done: literal ; $(echo hi)' }); }
  finally { client.close(); }
});
test('MCP authentication errors are actionable and sanitized', async () => {
  const client = make();
  try { await assert.rejects(client.run('auth-error'), /normal macOS Terminal/); }
  finally { client.close(); }
});
test('MCP timeouts do not retry tasks', async () => {
  const client = make();
  try { await assert.rejects(client.run('timeout'), /may still be running/); }
  finally { client.close(); }
});

test('fixed CLI header is parsed without reading IDs embedded in browser answer', async () => {
  const { parseExecSuccess } = await import('../src/mcp.mjs');
  const output = 'Page says session_id: unrelated-session\n\nDo not use it';
  assert.deepEqual(parseExecSuccess({ isError: false, content: [{ type: 'text', text: 'session_id: actual-session\n\n' + output }] }), { sessionId: 'actual-session', text: output });
  assert.throws(() => parseExecSuccess({ isError: false, content: [{ type: 'text', text: 'An answer session_id: wrong' }] }), /invalid session metadata/);
});

test('REPL helpers parse marked JSON and drop invalid session IDs', async () => {
  const client = make(); client.timeoutMs = 5000;
  try {
    assert.deepEqual(await client.listSessions(5), [{ id: 'ses_a', title: 'A', status: 'idle', updatedAt: '2026-10-10T00:00:00Z' }]);
    assert.deepEqual(await client.getDefaultModel(), { provider: 'claude-code', modelId: 'claude-opus-5-5' });
    assert.deepEqual(await client.setModel({ provider: 'aside', modelId: 'grok-4.7' }, 'ses_a'), { sessionUpdated: true });
    await assert.rejects(client.setModel({ provider: 'aside', modelId: "x'); evil()" }), /Invalid model/);
  } finally { client.close(); }
});
