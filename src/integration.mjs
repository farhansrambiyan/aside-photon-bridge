import { imessage } from '@spectrum-ts/imessage';
import { config } from './config.mjs';
import { AsideMCP } from './mcp.mjs';
import { Bridge } from './bridge.mjs';
import { normalizePhoton } from './photon-adapter.mjs';

// Add this handler to an existing Photon app to avoid two listeners competing.
// It consumes every allowlisted direct text message, including ordinary tasks.
// Route those conversations to this handler exclusively, not a second agent.
export function createAsideHandler(options = {}) {
  const cfg = { ...config(), ...options };
  if (!cfg.allowedSenders.size) throw new Error('ALLOWED_SENDERS is required.');
  const mcp = options.mcp || new AsideMCP({ ...cfg, onDiagnostic: text => console.error(text) });
  const bridge = new Bridge({ ...cfg, mcp });
  return {
    async handle(space, message) {
      const input = normalizePhoton(space, message, imessage);
      if (!input) return false;
      const result = await bridge.handle(input);
      return !result.ignored;
    },
    stop() { bridge.stop(); },
    async idle() { await bridge.queue; },
  };
}
