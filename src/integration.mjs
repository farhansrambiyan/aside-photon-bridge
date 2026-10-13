import { imessage } from '@spectrum-ts/imessage';
import { config } from './config.mjs';
import { AsideMCP } from './mcp.mjs';
import { Bridge } from './bridge.mjs';
import { normalizePhoton } from './photon-adapter.mjs';
import { MediaStore } from './media.mjs';
import { createTranscriber } from './transcribe.mjs';

// Add this handler to an existing Photon app to avoid two listeners competing.
// It consumes every allowlisted direct text message, including ordinary tasks.
// Route those conversations to this handler exclusively, not a second agent.
export function createAsideHandler(options = {}) {
  const cfg = { ...config(), ...options };
  if (!cfg.allowedSenders.size) throw new Error('ALLOWED_SENDERS is required.');
  const mcp = options.mcp || new AsideMCP({ ...cfg, onDiagnostic: text => console.error(text) });
  let media = options.media;
  if (media === undefined) {
    const transcriber = createTranscriber(cfg);
    media = new MediaStore({ dir: cfg.mediaDir, maxBytes: cfg.mediaMaxMb * 1048576, keepDays: cfg.mediaKeepDays, transcribe: transcriber?.transcribe });
    media.cleanup();
    setInterval(() => { void media.cleanup(); }, 6 * 3600000).unref();
    console.log(`Attachments: saved to a private folder and handed to Aside. Voice transcription: ${transcriber ? transcriber.name : 'not set up (run npm run setup-voice)'}`);
  }
  const bridge = new Bridge({ ...cfg, mcp, media });
  if (options.assistantFactory) bridge.assistant = options.assistantFactory(bridge);
  return {
    async handle(space, message) {
      const input = normalizePhoton(space, message, imessage);
      if (!input) return false;
      const result = await bridge.handle(input);
      return !result.ignored;
    },
    bridge,
    stop() { bridge.assistant?.stop(); bridge.stop(); },
    async idle() { await bridge.queue; },
  };
}
