import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { config, root } from './config.mjs';
import { AsideMCP } from './mcp.mjs';
const cfg = config();
let stopping = false, child, mcp;
const aborted = new AbortController();
function stop() {
  stopping = true; aborted.abort(); mcp?.close(); child?.kill('SIGTERM');
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
console.log('Background bridge starting; waiting for Aside Browser and the login keychain.');
let ready = false;
while (!stopping && !ready) {
  mcp = new AsideMCP({ ...cfg, timeoutMs: 30000 });
  try {
    await mcp.connect();
    const response = await mcp.request('tools/call', { name: 'repl', arguments: { title: 'Check bridge connectivity', code: "console.log('aside-bridge-connected')" } }, 30000);
    ready = !response.isError && JSON.stringify(response).includes('aside-bridge-connected');
  } catch {} finally { mcp.close(); mcp = undefined; }
  if (!ready && !stopping) await delay(15000, undefined, { signal: aborted.signal }).catch(() => {});
}
if (!stopping && ready) {
  console.log('Aside authenticated. Starting Photon background listener.');
  child = spawn(process.execPath, ['--env-file=.env', 'src/photon.mjs'], { cwd: root, stdio: 'inherit', shell: false });
  const code = await new Promise(resolve => {
    child.on('error', () => resolve(1)); child.on('exit', status => resolve(status ?? 1));
  });
  process.exitCode = stopping ? 0 : code || 1; // launchd restarts after an unexpected exit
}
