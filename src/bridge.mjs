import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { plainReply } from './plain-text.mjs';
import { findModel, formatModels, modelName } from './models.mjs';
import { isReminderRequest } from './reminders.mjs';
import { composeMediaPrompt } from './media.mjs';

const help = 'Just message me and I will do it in Aside. Follow-ups continue the same conversation.\n\nReply to any earlier answer to continue that conversation.\n\nReminders: remind me tomorrow morning to call mom, or remind me in 2 hours to check the oven\n/reminders - list upcoming reminders\n/cancel <number> - cancel a reminder\n/watch on, off, <minutes>, ai or rules - important email alerts\n/briefing - today calendar, important email and reminders\n\n/new - start fresh (/new <task> runs it right away)\n/sessions - list recent sessions\n/switch <number> - continue a session from /sessions\n/models - list models\n/model <number> - switch model\n/status - bridge status\n/help - this message\n\nNever send passwords or API keys here.';

export function parseInput(text) {
  const trimmed = text.trim();
  const legacy = /^\/aside(?:\s|$)/i.test(trimmed);
  const input = legacy ? trimmed.replace(/^\/aside(?:\s+|$)/i, '').trim() : trimmed;
  if (legacy && !input) return { command: 'help' };
  const command = input.match(legacy ? /^(?:\/)?(new|status|help|sessions|switch|models|model|reminders|cancel|watch|briefing)(?:\s+([\s\S]*))?$/i : /^\/(new|status|help|sessions|switch|models|model|reminders|cancel|watch|briefing)(?:\s+([\s\S]*))?$/i);
  if (command) return { command: command[1].toLowerCase(), prompt: command[2]?.trim() || '' };
  if (input.startsWith('/')) return { command: 'unknown' };
  return { command: 'task', prompt: input };
}
const digest = value => createHash('sha256').update(value).digest('hex');
const msgKey = (spaceId, id) => digest('m\0' + spaceId + '\0' + id);
const quiet = () => !!process.env.NODE_TEST_CONTEXT;
const log = msg => { if (!quiet()) console.log(`[bridge] ${new Date().toISOString()} ${msg}`); };
// Log who, never what: enough to see why a message was ignored.
const mask = id => { const s = String(id || ''); const at = s.indexOf('@'); return at > 0 ? s[0] + '***' + s.slice(at) : '***' + s.slice(-4); };
// Same phone/email written differently (spaces, dashes, case) is the same sender.
const normId = id => { const s = String(id || '').trim(); return s.includes('@') ? s.toLowerCase() : s.replace(/[\s().-]/g, ''); };
const cleanQuote = t => String(t || '').replace(/[\u0000-\u001f\u200b-\u200f\ufeff]/g, ' ').replace(/\s+/g, ' ').replace(/["“”]/g, "'").trim().slice(0, 400);

export class Bridge {
  constructor({ mcp, allowedSenders, allowedSpaces = new Set(), stateDir, maxQueue = 10, assistant = null, typingMs = 15000, busyWaitMs = 3000, busyTries = 6, media = null, echoTranscript = true }) {
    this.media = media; this.echoTranscript = echoTranscript;
    this.typingMs = typingMs; this.busyWaitMs = busyWaitMs; this.busyTries = busyTries;
    this.assistant = assistant; this.mcp = mcp; this.allowedSenders = allowedSenders; this.allowedSpaces = allowedSpaces;
    this.stateDir = stateDir; this.state = { sessions: {}, seen: [], blocked: false, inFlight: false, msgSessions: {} }; this.queue = Promise.resolve();
    this.waiting = 0; this.maxQueue = maxQueue; this.loaded = false; this.stopped = false;
  }
  async load() {
    await fs.mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    try {
      const state = JSON.parse(await fs.readFile(path.join(this.stateDir, 'sessions.json'), 'utf8'));
      if (!state || typeof state.sessions !== 'object' || !Array.isArray(state.seen)) throw new Error('Invalid state.');
      this.state = state;
      if (!this.state.msgSessions || typeof this.state.msgSessions !== 'object') this.state.msgSessions = {};
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
  isAllowedSender(senderId) { const id = normId(senderId); return !!id && [...this.allowedSenders].some(a => normId(a) === id); }
  // Shows the typing bubble in iMessage for as long as Aside is working.
  async withTyping(typing, fn) {
    if (!typing) return fn();
    const ping = () => Promise.resolve().then(() => typing.start()).catch(() => {});
    await ping();
    const timer = setInterval(() => { void ping(); }, this.typingMs); timer.unref?.();
    try { return await fn(); }
    finally { clearInterval(timer); await Promise.resolve().then(() => typing.stop()).catch(() => {}); }
  }
  // A session already running (for example in the Aside app) would make us wait silently.
  async sessionReady(sessionId) {
    if (typeof this.mcp.sessionInfo !== 'function') return true;
    for (let i = 0; i < this.busyTries; i++) {
      let info; try { info = await this.mcp.sessionInfo(sessionId); } catch { return true; }
      if (!info || info.status !== 'running') return true;
      if (i < this.busyTries - 1) await new Promise(resolve => setTimeout(resolve, this.busyWaitMs));
    }
    return false;
  }
  async handle({ senderId, spaceId, messageId, text, isDirect = false, reply, typing, markRead, replyTo, quoted, unsupported, media }) {
    if (this.stopped) return { ignored: true };
    // Fail closed: unknown identities and groups are never browser commands.
    if (isDirect !== true) { log(`ignored: not a direct chat (from ${mask(senderId)})`); return { ignored: true }; }
    if (!this.isAllowedSender(senderId)) { log(`ignored: sender ${mask(senderId)} is not in ALLOWED_SENDERS`); return { ignored: true }; }
    if (this.allowedSpaces.size && !this.allowedSpaces.has(spaceId)) { log('ignored: conversation is not in ALLOWED_SPACES'); return { ignored: true }; }
    const hasMedia = Array.isArray(media) && media.length > 0;
    if (hasMedia && !this.media) unsupported = 'attachment'; // no media support configured
    if (!unsupported && !hasMedia && (typeof text !== 'string' || !text.trim())) return { ignored: true };
    if (!messageId || !spaceId) return { ignored: true };
    const deliver = reply;
    reply = async (message, ids) => {
      const clean = plainReply(message, Object.values(this.state.sessions));
      if (!clean) return;
      for (const chunk of splitReply(clean)) { const id = await deliver(chunk); if (typeof id === 'string' && ids) ids.push(id); }
    };
    // Read receipt: the sender sees the message arrived, without any extra text.
    Promise.resolve().then(() => markRead?.()).catch(() => {});
    if (this.waiting >= this.maxQueue) { await reply('Bridge queue is full. Try again after the current tasks finish.'); return { busy: true }; }
    // Only say something when there is actually a wait.
    if (this.waiting > 0 && !unsupported) await reply('Queued. I will start after the current task.').catch(() => {});
    log(`accepted message from ${mask(senderId)}${replyTo ? ' (swipe-reply)' : ''}${this.waiting > 0 ? ', queued' : ''}`);
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
      if (unsupported) { await reply('I cannot read that kind of attachment. Please send photos, videos, voice messages or text.'); return { command: 'unsupported' }; }
      const parsed = parseInput(text);
      let prompt = parsed.prompt || '';
      if (parsed.command === 'help') { await reply(help); return { command: 'help' }; }
      if (['reminders', 'cancel', 'watch', 'briefing'].includes(parsed.command) || (parsed.command === 'task' && isReminderRequest(prompt))) {
        if (!this.assistant) { await reply('Reminders and alerts are available in iMessage mode only.'); return { command: parsed.command }; }
        const a = this.assistant;
        if (parsed.command === 'briefing' && !prompt) {
          // On-demand briefing. Already inside the task queue, so call Aside directly.
          if (this.state.blocked) { await reply('Tasks are paused because an earlier request may still be running. Check Aside, then run npm run unblock on the Mac.'); return { blocked: true }; }
          await reply('Getting your briefing from Gmail and Calendar...');
          try { await reply(await this.withTyping(typing, async () => (await this.mcp.run(a.briefingPrompt())).text + a.remindersToday())); }
          catch (error) { await reply(`Could not get the briefing: ${safeError(error)}`); }
          return { command: 'briefing' };
        }
        const answer = parsed.command === 'reminders' ? a.listReminders() : parsed.command === 'cancel' ? await a.cancelReminder(prompt)
          : parsed.command === 'watch' ? await a.setWatch(prompt) : parsed.command === 'briefing' ? await a.setBriefing(prompt) : await a.addReminder(prompt);
        await reply(answer); return { command: parsed.command === 'task' ? 'remind' : parsed.command };
      }
      if (parsed.command === 'unknown') { await reply('Unknown command. Use /help to see commands, or just send your task normally.'); return { command: 'unknown' }; }
      if (parsed.command === 'sessions') {
        try {
          const list = await this.mcp.listSessions(10);
          this.state.lastList = this.state.lastList || {};
          this.state.lastList[key] = list.map(s => s.id); await this.save();
          if (!list.length) { await reply('No sessions found yet.'); return { command: 'sessions' }; }
          const current = this.state.sessions[key];
          const lines = list.map((s, i) => `${i + 1}. ${cleanTitle(s.title)} (${ago(s.updatedAt)}${s.status === 'running' ? ', running' : ''})${s.id === current ? ' (current)' : ''}`);
          await reply('Recent sessions:\n' + lines.join('\n') + '\n\nReply /switch <number> to continue one.');
        } catch (error) { await reply(`Could not list sessions: ${safeError(error)}`); }
        return { command: 'sessions' };
      }
      if (parsed.command === 'switch') {
        const ids = this.state.lastList?.[key] || [];
        let target = null;
        if (/^\d+$/.test(prompt)) target = ids[Number(prompt) - 1] || null;
        if (!prompt || !target) { await reply(ids.length ? `Send /switch followed by a number from 1 to ${ids.length}.` : 'Send /sessions first, then /switch <number>.'); return { command: 'switch', switched: false }; }
        let info = null;
        try { info = await this.mcp.sessionInfo(target); } catch {}
        this.state.sessions[key] = target; await this.save();
        await reply(`Switched to: ${cleanTitle(info?.title)}. Your next message continues that session.${info?.status === 'running' ? ' It is still running, so wait for it to finish first.' : ''}`);
        return { command: 'switch', switched: true, sessionId: target };
      }
      if (parsed.command === 'models') {
        let current = null;
        try { current = await this.mcp.getDefaultModel(); } catch {}
        await reply('Models:\n' + formatModels(current) + '\n\nReply /model <number> to switch.');
        return { command: 'models' };
      }
      if (parsed.command === 'model') {
        if (!prompt) {
          try { await reply(`Current model: ${modelName(await this.mcp.getDefaultModel())}. Send /models to see options.`); }
          catch (error) { await reply(`Could not read the model: ${safeError(error)}`); }
          return { command: 'model' };
        }
        const model = findModel(prompt);
        if (!model) { await reply('I could not find that model. Send /models and pick a number.'); return { command: 'model', switched: false }; }
        try {
          const result = await this.mcp.setModel(model, this.state.sessions[key]);
          await reply(`Switched to ${model.name}. New sessions will use it${result?.sessionUpdated ? ', and so will this conversation' : ''}. This is also the default model in the Aside app.`);
          return { command: 'model', switched: true };
        } catch (error) { await reply(`Could not switch model: ${safeError(error)}`); return { command: 'model', switched: false }; }
      }
      if (parsed.command === 'status') {
        await reply(`Bridge is running. Aside ${this.mcp.ready ? 'MCP connected' : 'connects on the next task'}. ${this.state.sessions[key] ? 'Your conversation has a saved browser session.' : 'No saved browser session yet.'}${this.assistant ? '\n' + this.assistant.status() : ''}${this.state.blocked ? '\nTasks are paused after an uncertain failure. Check Aside, then run npm run unblock locally.' : ''}`);
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
      // Photos, videos and files are saved and handed to Aside by path; voice becomes text.
      if (hasMedia && !unsupported && (parsed.command === 'task' || parsed.command === 'new')) {
        let got;
        try { got = await this.withTyping(typing, () => this.media.handle(media)); }
        catch { await reply('I could not read the attachment. Please try again.'); return { rejected: true }; }
        if (got.heard.length && this.echoTranscript) await reply(`Heard: ${got.heard.join(' / ')}`);
        prompt = composeMediaPrompt(prompt, got);
        if (!prompt) { await reply(got.problems.join(' ') || 'I could not read that attachment.'); return { rejected: true }; }
        log(`attachments: ${got.lines.length} file(s), ${got.heard.length} voice`);
      }
      // Swiping reply on an earlier answer continues the conversation that produced it.
      const mapped = replyTo && parsed.command === 'task' ? this.state.msgSessions?.[msgKey(spaceId, replyTo)] || null : null;
      const previousSession = mapped || this.state.sessions[key];
      try {
        let result;
        if (this.assistant?.contextFor) { try { prompt = await this.assistant.contextFor(prompt); } catch {} }
        let taskPrompt = prompt;
        const quote = cleanQuote(quoted);
        if (replyTo && parsed.command === 'task' && !mapped && quote) taskPrompt = `(I am replying to this earlier message: "${quote}")\n\n${prompt}`;
        try {
          // Typing starts only now, when Aside actually begins working (not while queued).
          result = await this.withTyping(typing, async () => {
            if (previousSession && !(await this.sessionReady(previousSession))) return null;
            this.state.inFlight = true; await this.save();
            return this.mcp.run(taskPrompt, previousSession);
          });
        } catch (error) {
          this.state.inFlight = false;
          if (error.mayHaveRun) this.state.blocked = true;
          await this.save(); throw error;
        }
        if (!result) { await reply('That conversation is still busy in Aside. Wait for it to finish, or send /new to start a fresh one.'); return { busy: true }; }
        this.state.inFlight = false;
        if (result.sessionId) this.state.sessions[key] = result.sessionId;
        if (!result.sessionId && !previousSession) this.state.blocked = true;
        await this.save();
        const output = result.text || 'Aside returned no text. Check the task in the desktop app.';
        const sentIds = [];
        await reply(output, sentIds);
        const sid = result.sessionId || previousSession;
        if (sid && sentIds.length) {
          this.state.msgSessions ||= {};
          for (const id of sentIds) this.state.msgSessions[msgKey(spaceId, id)] = sid;
          const keys = Object.keys(this.state.msgSessions);
          if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete this.state.msgSessions[k];
          await this.save();
        }
        if (!result.sessionId && !previousSession) await reply('I could not save this conversation. Follow-ups are paused to avoid starting an unrelated task. Check Aside on the Mac.');
        return { success: true, sessionId: result.sessionId || previousSession };
      } catch (error) {
        if (error.mayHaveRun) { this.state.blocked = true; await this.save(); }
        await reply(`Bridge error: ${safeError(error)}\nCheck Aside before retrying to avoid repeating an action.`);
        return { success: false };
      }
    });
    this.queue = work.catch(() => {});
    try { return await work; } finally { this.waiting--; }
  }
  // Read-only proactive work (email checks, briefings). Shares the task queue so
  // it never drives the browser at the same time as your own requests.
  runBackground(prompt) {
    const work = this.queue.then(async () => {
      if (this.stopped) return null;
      if (!this.loaded) await this.load();
      if (this.state.blocked) return null;
      try { return plainReply((await this.mcp.run(prompt)).text); }
      catch { console.error('Background Aside check failed. Details hidden.'); return null; }
    });
    this.queue = work.catch(() => {});
    return work;
  }
  // Plain deterministic REPL code in Aside (no AI model). Queued like tasks.
  runRepl(code) {
    const work = this.queue.then(async () => {
      if (this.stopped) return null;
      if (!this.loaded) await this.load();
      if (this.state.blocked) return null;
      try {
        await this.mcp.connect();
        const result = await this.mcp.request('tools/call', { name: 'repl', arguments: { title: 'Check for new email', code } }, 90000);
        if (result?.isError) return null;
        return (result?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
      } catch { console.error('Gmail lookup failed. Details hidden.'); return null; }
    });
    this.queue = work.catch(() => {});
    return work;
  }
  // Proactive message to the owner with the same plain-text formatting as replies.
  async notify(send, text) {
    const clean = plainReply(text, Object.values(this.state.sessions));
    for (const chunk of splitReply(clean)) await send(chunk);
  }
  stop() { this.stopped = true; this.mcp.close(); }
}
// Only fixed messages created by this bridge are sent; filesystem/provider errors may contain local details.
const safeMessages = new Set(['Aside timed out. Check the task in Aside before retrying; it may still be running.','Aside authentication failed. Start this bridge from your normal macOS Terminal, as the same user running Aside.','Aside could not complete this request. Check Aside for the error or approval prompt.','Aside MCP rejected the request. Check the Aside desktop app for details.','Aside response format changed. Check the desktop app before continuing.','Aside returned missing or invalid session metadata. Check the desktop app.','Aside connection was interrupted. Check Aside before retrying.','Aside MCP exited. Run npm run doctor from Terminal.','Cannot start Aside CLI. Run npm run doctor from Terminal.','Aside is not connected.','Bridge stopped. Check Aside before retrying any task.','Aside could not read sessions or models. Check the Aside app.']);
function cleanTitle(title) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Untitled session';
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
}
function ago(value, now = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'unknown time';
  const minutes = Math.max(0, Math.round((now - time) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export function safeError(error) { return safeMessages.has(error?.message) ? error.message : 'The bridge hit an unexpected local error. Check the Mac logs.'; }
export function splitReply(text, size = 3000) {
  const chars = Array.from(text); const parts = [];
  for (let i = 0; i < chars.length && parts.length < 8; i += size) parts.push(chars.slice(i, i + size).join(''));
  if (chars.length > size * 8) parts.push('Output truncated. Open Aside for the complete result.');
  return parts;
}
