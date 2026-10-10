import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class AsideMCP {
  constructor({ cli, account, timeoutMs = 1200000, spawnImpl = spawn, args, onDiagnostic = () => {} }) {
    this.cli = cli; this.args = args || ['mcp', '--account', account];
    this.timeoutMs = timeoutMs; this.spawnImpl = spawnImpl; this.onDiagnostic = onDiagnostic;
    this.sequence = 0; this.pending = new Map(); this.child = null; this.ready = null;
  }
  async connect() {
    if (this.ready) return this.ready;
    this.ready = this.initialize();
    try { return await this.ready; } catch (error) { this.close(); throw error; }
  }
  async initialize() {
    const child = this.spawnImpl(this.cli, this.args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let data; try { data = JSON.parse(line); } catch { return; }
      const request = this.pending.get(data.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(data.id);
      if (data.error) request.reject(new Error('Aside MCP rejected the request. Check the Aside desktop app for details.')); 
      else request.resolve(data.result);
    });
    child.stderr.on('data', data => {
      // Never forward raw process diagnostics to iMessage: they can contain local details.
      if (/keychain|SecItem|auth.*fail|cdp-sign/i.test(String(data))) this.onDiagnostic('Aside authentication needs normal macOS Terminal access.');
    });
    const fail = error => {
      if (this.child !== child) return;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear(); this.child = null; this.ready = null;
    };
    child.on('error', () => fail(new Error('Cannot start Aside CLI. Run npm run doctor from Terminal.')));
    child.stdin.on('error', () => fail(new Error('Aside connection was interrupted. Check Aside before retrying.')));
    child.stdout.on('error', () => fail(new Error('Aside connection was interrupted. Check Aside before retrying.')));
    child.stderr.on('error', () => {});
    child.on('exit', () => fail(new Error('Aside MCP exited. Run npm run doctor from Terminal.')));
    await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'aside-photon-bridge', version: '1.0.0' } }, 30000);
    this.notify('notifications/initialized', {});
    const listed = await this.request('tools/list', {}, 30000);
    if (!listed.tools?.some(tool => tool.name === 'exec')) throw new Error('This Aside CLI does not expose the exec tool.');
    return listed.tools;
  }
  notify(method, params) {
    if (!this.child?.stdin.writable) throw new Error('Aside is not connected.');
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  request(method, params, timeout = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        try { this.notify('notifications/cancelled', { requestId: id, reason: 'Bridge timeout' }); } catch {}
        reject(new Error('Aside timed out. Check the task in Aside before retrying; it may still be running.'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        if (!this.child?.stdin.writable) throw new Error('Aside is not connected.');
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => {
          if (error && this.pending.has(id)) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Cannot write to Aside MCP.')); }
        });
      } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async run(prompt, sessionId) {
    await this.connect();
    const args = { prompt };
    if (sessionId) args.session_id = sessionId;
    let result;
    try { result = await this.request('tools/call', { name: 'exec', arguments: args }); }
    catch (error) { error.mayHaveRun = true; throw error; }
    const text = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    if (result.isError) {
      if (/auth|keychain|cdp-sign|SecItem/i.test(text)) throw new Error('Aside authentication failed. Start this bridge from your normal macOS Terminal, as the same user running Aside.');
      throw new Error('Aside could not complete this request. Check Aside for the error or approval prompt.');
    }
    return parseExecSuccess(result);
  }
  close() {
    const child = this.child;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Bridge stopped. Check Aside before retrying any task.')); }
    this.pending.clear(); this.child = null; this.ready = null;
    if (child) { child.stdin.end(); child.kill('SIGTERM'); }
  }
}

// Aside CLI 1.26.1008.1938 prepends this protocol header before agent text.
// Parse only the first fixed header, never IDs mentioned inside the answer.
export function parseExecSuccess(result) {
  const fail = message => { const error = new Error(message); error.mayHaveRun = true; throw error; };
  if (result?.isError !== false || !Array.isArray(result.content) || result.content.length !== 1 || result.content[0]?.type !== 'text' || typeof result.content[0].text !== 'string') {
    fail('Aside response format changed. Check the desktop app before continuing.');
  }
  const raw = result.content[0].text;
  const header = /^session_id: ([A-Za-z0-9_-]{1,128})\n\n/.exec(raw);
  if (!header) fail('Aside returned missing or invalid session metadata. Check the desktop app.');
  return { sessionId: header[1], text: raw.slice(header[0].length) };
}
