import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { config } from './config.mjs';
import { AsideMCP } from './mcp.mjs';
const cfg = config();
let failed = false;
function report(ok, text) { console.log(`${ok ? 'OK' : 'NEEDS SETUP'}: ${text}`); if (!ok) failed = true; }
report(process.platform === 'darwin', 'Run on the Mac with Aside Browser.');
try { await fs.access(cfg.cli, constants.X_OK); report(true, 'Aside CLI installed.'); } catch { report(false, 'Aside CLI missing.'); }
report(Boolean(cfg.projectId && cfg.projectSecret), 'Photon project credentials configured (values hidden).');
report(cfg.allowedSenders.size > 0, 'Allowed sender IDs configured (values hidden).');
const mcp = new AsideMCP({ ...cfg, timeoutMs: 30000, onDiagnostic: text => console.log('NOTE: ' + text) });
try {
  const tools = await mcp.connect(); report(tools.some(t => t.name === 'exec'), 'Aside MCP exec tool available.');
  // Deterministic harmless read. Listing tools alone does not verify daemon authentication.
  const result = await mcp.request('tools/call', { name: 'repl', arguments: { title: 'Check bridge connectivity', code: "console.log('aside-bridge-connected')" } }, 30000);
  report(!result.isError && JSON.stringify(result).includes('aside-bridge-connected'), 'Authenticated connection to Aside Browser.');
} catch (error) { report(false, error.message); }
finally { mcp.close(); }
if (failed) { console.log('Run npm run setup and npm run doctor in normal macOS Terminal. Do not reset Aside keys or sign out.'); process.exitCode = 1; }
