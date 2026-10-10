import { createInterface } from 'node:readline/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';
const cfg = config();
if (process.argv.includes('--terminal')) cfg.stateDir = path.join(cfg.stateDir, 'terminal');
try { await fs.access(path.join(cfg.stateDir, 'bridge.lock')); console.error('Stop the bridge before unblocking.'); process.exit(1); } catch {}
const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const answer = await terminal.question('Have you checked Aside and stopped/finished any earlier task? Type yes: ');
  if (answer.trim() !== 'yes') { console.log('No changes.'); process.exitCode = 1; }
  else {
    const file = path.join(cfg.stateDir, 'sessions.json');
    const state = JSON.parse(await fs.readFile(file, 'utf8')); state.blocked = false; state.inFlight = false;
    await fs.writeFile(file + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 });
    await fs.rename(file + '.tmp', file); console.log('Unblocked. Restart the bridge.');
  }
} finally { terminal.close(); }
