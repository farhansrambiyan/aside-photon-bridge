import { Spectrum } from 'spectrum-ts';
import { imessage } from '@spectrum-ts/imessage';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';
import { createAsideHandler } from './integration.mjs';
import { Assistant } from './assistant.mjs';

const cfg = config();
if (!cfg.projectId || !cfg.projectSecret || !cfg.allowedSenders.size) {
  console.error('Run npm run setup first. Photon credentials and ALLOWED_SENDERS are required.');
  process.exit(1);
}
await fs.mkdir(cfg.stateDir, { recursive: true, mode: 0o700 });
const lockPath = path.join(cfg.stateDir, 'bridge.lock');
async function takeLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await fs.open(lockPath, 'wx', 0o600); await file.writeFile(String(process.pid)); await file.close(); return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await fs.readFile(lockPath, 'utf8'));
      if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid bridge lock; check that no bridge is running before removing state/bridge.lock.');
      try { process.kill(pid, 0); throw new Error('Another bridge is already running.'); }
      catch (check) {
        if (check.code !== 'ESRCH') throw check;
        await fs.unlink(lockPath);
      }
    }
  }
  throw new Error('Could not acquire bridge lock.');
}
await takeLock();
let app, handler, shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  handler?.stop();
  if (app) await app.stop().catch(() => {});
  await fs.unlink(lockPath).catch(() => {});
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
try {
  console.log('Connecting Photon. No task text or credentials are written to logs.');
  // Supplied credentials route to the existing project; no separate channel account.
  app = await Spectrum({ projectId: cfg.projectId, projectSecret: cfg.projectSecret, providers: [imessage.config()] });
  // Proactive messages go only to the first allowlisted sender (the owner).
  const owner = [...cfg.allowedSenders][0];
  let ownerSpace;
  const sendToOwner = async text => {
    ownerSpace ??= await imessage(app).space.create(owner);
    const sent = await ownerSpace.send(text);
    if (!sent) throw new Error('Photon did not accept the message.');
  };
  handler = createAsideHandler({ ...cfg, assistantFactory: bridge => new Assistant({
    bridge, stateDir: cfg.stateDir, timeZone: cfg.timeZone, accountHint: cfg.googleAccount,
    watchIntervalMin: cfg.watchIntervalMin, gmailUid: cfg.gmailUid, emailMode: cfg.emailMode, watchStart: cfg.watchStart, watchEnd: cfg.watchEnd, briefingTime: cfg.briefingTime,
    send: text => bridge.notify(sendToOwner, text),
  }) });
  await handler.bridge.assistant.load();
  handler.bridge.assistant.start();
  console.log('Photon connected. Ordinary direct messages continue your Aside session; /new starts fresh. Only allowed sender(s) are accepted.');
  // Avoid blocking the SDK event consumer while a browser task runs. Bridge owns
  // a bounded, serialized task queue and persistent message deduplication.
  for await (const [space, message] of app.messages) {
    if (shuttingDown) break;
    void handler.handle(space, message).catch(() => console.error('Message could not be processed or reply could not be sent. Check Aside before retrying.'));
  }
  await handler.idle();
} catch {
  console.error('Photon connection failed. Check project credentials, internet access, and the Photon dashboard. Secret values are not printed.');
  process.exitCode = 1;
} finally { await shutdown(); }
