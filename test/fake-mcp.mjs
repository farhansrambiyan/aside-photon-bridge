import { createInterface } from 'node:readline';
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  const req = JSON.parse(line);
  if (!req.id) continue;
  let result;
  if (req.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: {} };
  else if (req.method === 'tools/list') result = { tools: [{ name: 'exec' }] };
  else if (req.params.arguments.prompt === 'timeout') continue;
  else if (req.params.arguments.prompt === 'auth-error') result = { isError: true, content: [{ type: 'text', text: 'cdp-sign auth failed' }] };
  else result = { isError: false, content: [{ type: 'text', text: 'session_id: session-123\n\ndone: ' + req.params.arguments.prompt }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n');
}
