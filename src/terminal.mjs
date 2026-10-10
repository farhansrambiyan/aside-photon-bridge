import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config } from './config.mjs';
import { AsideMCP } from './mcp.mjs';
import { Bridge } from './bridge.mjs';
const cfg = config();
const mcp = new AsideMCP({ ...cfg, onDiagnostic: text => console.error(text) });
const bridge = new Bridge({ ...cfg, mcp, allowedSenders: new Set(['local-terminal']), stateDir: path.join(cfg.stateDir, 'terminal') });
const terminal = createInterface({ input: process.stdin, output: process.stdout });
console.log('Aside terminal bridge. Type a task, /new, /status, /help, or exit.');
process.on('SIGINT', () => { bridge.stop(); terminal.close(); });
try {
  for (;;) {
    let text; try { text = await terminal.question('aside> '); } catch { break; }
    if (text.trim() === 'exit') break;
    if (!text.trim()) continue;
    await bridge.handle({ senderId: 'local-terminal', spaceId: 'terminal', messageId: randomUUID(), text, isDirect: true, reply: async message => console.log(message) });
  }
} finally { bridge.stop(); terminal.close(); }
