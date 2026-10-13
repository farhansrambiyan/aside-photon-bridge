import { createInterface } from 'node:readline';
const input = createInterface({ input: process.stdin });
const marker = '__ASIDE_BRIDGE_JSON__';
for await (const line of input) {
  const req = JSON.parse(line);
  if (!req.id) continue;
  let result;
  if (req.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: {} };
  else if (req.method === 'tools/list') result = { tools: [{ name: 'exec' }, { name: 'repl' }] };
  else if (req.params.name === 'repl') {
    const code = req.params.arguments.code;
    let value;
    if (code.includes('aside.sessions.list')) value = [{ id: 'ses_a', title: 'A', status: 'idle', updatedAt: '2026-10-10T00:00:00Z' }, { id: 'bad id!', title: 'x' }];
    else if (code.includes("aside.settings.get('defaultModel'); return")) value = { provider: 'claude-code', modelId: 'claude-opus-5-5' };
    else if (code.includes("aside.settings.set('defaultModel'")) value = { sessionUpdated: code.includes('"ses_a"') };
    result = { isError: false, content: [{ type: 'text', text: 'noise\n' + marker + JSON.stringify({ ok: true, value }) }] };
  }
  else if (req.params.arguments.prompt === 'timeout') continue;
  else if (req.params.arguments.prompt === 'auth-error') result = { isError: true, content: [{ type: 'text', text: 'cdp-sign auth failed' }] };
  else result = { isError: false, content: [{ type: 'text', text: 'session_id: session-123\n\ndone: ' + req.params.arguments.prompt }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n');
}
