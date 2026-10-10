import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { plainReply } from './plain-text.mjs';

const help = 'Just send a message to run an Aside task. Your next messages continue the same browser session.\n/new - start fresh on your next message\n/new <task> - start fresh and run that task\n/status - connection/session status\n/help - show commands\n\nOnly your allowlisted direct messages are accepted. Approvals may need the Aside desktop app. Never send passwords or API keys here.';

export function parseInput(text) {
  const trimmed = text.trim();
  const legacy = /^\/aside(?:\s|$)/i.test(trimmed);
  const input = legacy ? trimmed.replace(/^\/aside(?:\s+|$)/i, '').trim() : trimmed;
  if (legacy && !input) return { command: 'help' };
  const command = input.match(legacy ? /^(?:\/)?(new|status|help)(?:\s+([\s\S]*))?$/i : /^\/(new|status|help)(?:\s+([\s\S]*))?$/i);
  if (command) return { command: command[1].toLowerCase(), prompt: command[2]?.trim() || '' };
  if (input.startsWith('/')) return { command: 'unknown' };
  return { command: 'task', prompt: input };
}
const digest = value => createHash('sha256').update(value).digest('hex');

export class Bridge {
  constructor({ mcp, allowedSenders, allowedSpaces = new Set(), stateDir, maxQueue = 10 }) {
    this.mcp = mcp; this.allowedSenders = allowedSenders; this.allowedSpaces = allowedSpaces;
    this.stateDir = stateDir; this.state = { sessions: {}, seen: [], blocked: false, inFlight: false }; this.queue = Promise.resolve();
    this.waiting = 0; this.maxQueue = maxQueue; this.loaded = false; this.stopped = false;
  }
  async load() {
    await fs.mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    try {
      const state = JSON.parse(await fs.readFile(path.join(this.stateDir, 'sessions.json'), 'utf8'));
      if (!state || typeof state.sessions !== 'object' || !Array.isArray(state.seen)) throw new Error('Invalid state.');
      this.state = state;
      // A service restart during an execution must not replay or overlap that task.
      if (state.inFlight) { this.state.blocked = true; await this.save(); }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.loaded = true;
  }
  async save() {
    const file = path.join(this.stateDir, 'sessions.json');
    await fs.writeFile(file + '.tmp', JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await fs.rename(file + '.tmp', file);
  }
  async handle({ senderId, spaceId, messageId, text, isDirect = false, reply }) {
    // Fail closed: unknown identities and groups are never browser commands.
    if (this.stopped || isDirect !== true || !this.allowedSenders.has(senderId)) return { ignored: true };
    if (this.allowedSpaces.size && !this.allowedSpaces.has(spaceId)) return { ignored: true };
    if (typeof text !== 'string' || !text.trim()) return { ignored: true };
    if (!messageId || !spaceId) return { ignored: true };
    const deliver = reply;
    reply = async text => {
      const clean = plainReply(text, Object.values(this.state.sessions));
      if (!clean) return;
      for (const chunk of splitReply(clean)) await deliver(chunk);
    };
    if (this.waiting >= this.maxQueue) { await reply('Bridge queue is full. Try again after the current tasks finish.'); return { busy: true }; }
    this.waiting++;
    const work = this.queue.then(async () => {
      if (this.stopped) return { ignored: true };
      if (!this.loaded) await this.load();
      const key = digest(senderId + '\0' + spaceId);
      const event = digest(key + '\0' + messageId);
      if (this.state.seen.includes(event)) return { duplicate: true };
      // Save before executing to avoid repeated browser side effects after redelivery.
      this.state.seen.push(event); // Retain hashes: old side-effecting tasks must not replay.
      await this.save();
      const parsed = parseInput(text);
      let prompt = parsed.prompt || '';
      if (parsed.command === 'help') { await reply(help); return { command: 'help' }; }
      if (parsed.command === 'unknown') { await reply('Unknown command. Use /new, /status or /help, or just send your task normally.'); return { command: 'unknown' }; }
      if (parsed.command === 'status') {
        await reply(`Bridge is running. Aside ${this.mcp.ready ? 'MCP connected' : 'connects on the next task'}. ${this.state.sessions[key] ? 'Your conversation has a saved browser session.' : 'No saved browser session yet.'}${this.state.blocked ? '\nTasks are paused after an uncertain failure. Check Aside, then run npm run unblock locally.' : ''}`);
        return { command: 'status' };
      }
      if (parsed.command === 'new') {
        delete this.state.sessions[key]; await this.save();
        if (!prompt) {
          await reply('New conversation ready. Your next message starts a fresh Aside session. Earlier tasks are not cancelled.');
          return { command: 'new' };
        }
      }
      if (this.state.blocked) { await reply('Tasks are paused because an earlier request may still be running. Check Aside, then run npm run unblock on the Mac.'); return { blocked: true }; }
      if (prompt.length > 12000) { await reply('That task is too long. Keep it under 12,000 characters.'); return { rejected: true }; }
      try {
        await reply('I’m passing your task to Aside. If it asks for approval, check the Aside app on your Mac.');
        this.state.inFlight = true; await this.save();
        const previousSession = this.state.sessions[key];
        let result;
        try { result = await this.mcp.run(prompt, previousSession); }
        catch (error) {
          this.state.inFlight = false;
          if (error.mayHaveRun) this.state.blocked = true;
          await this.save(); throw error;
        }
        this.state.inFlight = false;
        if (result.sessionId) this.state.sessions[key] = result.sessionId;
        if (!result.sessionId && !previousSession) this.state.blocked = true;
        await this.save();
        const output = result.text || 'Aside returned no text. Check the task in the desktop app.';
        await reply(output);
        if (!result.sessionId && !previousSession) await reply('I could not save this conversation. Follow-ups are paused to avoid starting an unrelated task. Check Aside on the Mac.');
        return { success: true, sessionId: result.sessionId || previousSession };
      } catch (error) {
        if (error.mayHaveRun) { this.state.blocked = true; await this.save(); }
        await reply(`Bridge error: ${error.message}\nCheck Aside before retrying to avoid repeating an action.`);
        return { success: false };
      }
    });
    this.queue = work.catch(() => {});
    try { return await work; } finally { this.waiting--; }
  }
  stop() { this.stopped = true; this.mcp.close(); }
}
export function splitReply(text, size = 3000) {
  const chars = Array.from(text); const parts = [];
  for (let i = 0; i < chars.length && parts.length < 8; i += size) parts.push(chars.slice(i, i + size).join(''));
  if (chars.length > size * 8) parts.push('Output truncated. Open Aside for the complete result.');
  return parts;
}
