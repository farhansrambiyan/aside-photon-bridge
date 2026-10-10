import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { root, config } from './config.mjs';
import { serviceLabel, servicePlist } from './service-plist.mjs';
const cfg = config();
if (process.platform !== 'darwin') throw new Error('Background installation requires macOS.');
if (homedir().includes('/.aside/runtime/')) throw new Error('Run ./enable-autostart.command in normal macOS Terminal, not the Aside sandbox.');
if (!cfg.projectId || !cfg.projectSecret || !cfg.allowedSenders.size) throw new Error('Configure the bridge first.');
const service = `gui/${process.getuid()}/${serviceLabel}`;
const dir = path.join(homedir(), 'Library', 'LaunchAgents');
const file = path.join(dir, `${serviceLabel}.plist`);
await fs.mkdir(dir, { recursive: true });
await fs.mkdir(path.join(root, 'logs'), { recursive: true, mode: 0o700 });
await fs.writeFile(file, servicePlist(root, process.execPath), { mode: 0o600 });
try { execFileSync('/bin/launchctl', ['bootout', service], { stdio: 'ignore' }); } catch {}
// Stop only the exact standalone bridge owned by this user, never arbitrary PID.
try {
  const lock = path.join(cfg.stateDir, 'bridge.lock');
  const pid = Number(await fs.readFile(lock, 'utf8'));
  if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid bridge lock.');
  const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  const cwdOutput = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
  const cwd = cwdOutput.split('\n').find(line => line.startsWith('n'))?.slice(1);
  if (cwd !== root || !command.includes('node') || !/(?:^|\s)(?:\S*\/)?src\/photon\.mjs(?:\s|$)/.test(command)) throw new Error('Refusing to stop an unrecognized process. Stop the foreground bridge with Ctrl+C first.');
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') break; throw error; }
    if (i === 99) throw new Error('Foreground bridge did not stop. Stop it manually before enabling background mode.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await fs.unlink(lock).catch(() => {});
} catch (error) {
  if (error.code !== 'ENOENT' && error.status !== 1) throw error;
  // ps returns 1 for a stale PID; the listener cleans the stale lock on startup.
}
execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, file], { stdio: 'inherit' });
execFileSync('/bin/launchctl', ['enable', service], { stdio: 'inherit' });
execFileSync('/bin/launchctl', ['kickstart', service], { stdio: 'inherit' });
console.log('Background service enabled. It starts at login after reboot and restarts after exit. Terminal can be closed.');
console.log('The service waits for Aside Browser/login keychain, then connects to Photon. Text /status to verify.');
