import { Spectrum } from 'spectrum-ts';
import { imessage } from '@spectrum-ts/imessage';
import { config } from './config.mjs';
const cfg = config(); let app;
if (!cfg.projectId || !cfg.projectSecret) { console.error('Missing Photon configuration.'); process.exit(1); }
const timeout = setTimeout(() => { console.error('Photon connectivity check timed out.'); process.exit(1); }, 30000);
try {
  app = await Spectrum({ projectId: cfg.projectId, projectSecret: cfg.projectSecret, providers: [imessage.config()] });
  console.log('OK: Photon initialized with the existing project. No messages sent and no tasks executed.');
} catch { console.error('Photon could not initialize. Check credentials and network. Values hidden.'); process.exitCode = 1; }
finally { clearTimeout(timeout); if (app) await app.stop(); }
