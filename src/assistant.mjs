import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { formatWhen, parseReminder } from './reminders.mjs';
import { classifyPrompt, emailKey, formatAlert, gmailSearchCode, parseClassification, parseEmails, ruleImportant } from './email-filter.mjs';


export class Assistant {
  constructor({ bridge, send, stateDir, timeZone, watchIntervalMin = 5, gmailUid = 0, emailMode = 'ai', watchStart = 8, watchEnd = 22, briefingTime = null, accountHint = '', now = () => new Date() }) {
    Object.assign(this, { bridge, send, stateDir, timeZone, watchStart, watchEnd, accountHint, now, gmailUid });
    this.file = path.join(stateDir, 'assistant.json');
    this.outboxDir = path.join(stateDir, 'outbox');
    this.defaults = { notices: [], reminders: [], watch: { enabled: true, intervalMin: watchIntervalMin, lastCheck: null, mode: emailMode, seen: [] }, briefing: { time: briefingTime || null, lastDate: null } };
    this.state = structuredClone(this.defaults);
    this.timer = null; this.ticking = false; this.background = false;
  }
  async load() {
    await fs.mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.outboxDir, { recursive: true, mode: 0o700 });
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.state = { ...this.defaults, ...saved, watch: { ...this.defaults.watch, ...saved.watch }, briefing: { ...this.defaults.briefing, ...saved.briefing } };
      if (!Array.isArray(this.state.reminders)) this.state.reminders = [];
      if (!Array.isArray(this.state.notices)) this.state.notices = [];
      if (!saved.watch?.mode) this.state.watch.intervalMin = this.defaults.watch.intervalMin; // pre-1.3 default was 30
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Never dump an old inbox on first start: only mail after this moment counts.
    if (!this.state.watch.lastCheck) this.state.watch.lastCheck = this.now().toISOString();
    await this.save();
  }
  async save() {
    await fs.writeFile(this.file + '.tmp', JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await fs.rename(this.file + '.tmp', this.file);
  }
  start(intervalMs = 30000) {
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
    void this.tick();
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  // ----- chat commands -----
  async addReminder(text) {
    const parsed = parseReminder(text, this.now());
    if (parsed.error) return parsed.error;
    this.state.reminders.push({ id: randomUUID(), at: parsed.at.toISOString(), text: parsed.text, attempts: 0 });
    this.state.reminders.sort((a, b) => a.at.localeCompare(b.at));
    await this.save();
    return `Got it. I'll remind you ${formatWhen(parsed.at, this.timeZone)}: ${parsed.text}`;
  }
  listReminders() {
    if (!this.state.reminders.length) return 'No upcoming reminders.';
    return 'Upcoming reminders:\n' + this.state.reminders.map((r, i) => `${i + 1}. ${formatWhen(new Date(r.at), this.timeZone)}: ${r.text}`).join('\n') + '\n\nUse /cancel <number> to remove one.';
  }
  async cancelReminder(arg) {
    const index = Number(arg) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= this.state.reminders.length) return 'Send /reminders to see the list, then /cancel <number>.';
    const [removed] = this.state.reminders.splice(index, 1);
    await this.save();
    return `Cancelled: ${removed.text}`;
  }
  async setWatch(arg) {
    const value = (arg || '').trim().toLowerCase();
    if (value === 'on' || value === 'off') {
      this.state.watch.enabled = value === 'on';
      if (value === 'on') this.state.watch.lastCheck = this.now().toISOString();
      await this.save();
    } else if (value === 'rules' || value === 'ai') {
      this.state.watch.mode = value; await this.save();
    } else if (/^\d+$/.test(value) && Number(value) >= 2 && Number(value) <= 720) {
      this.state.watch.intervalMin = Number(value); this.state.watch.enabled = true; await this.save();
    } else if (value) return 'Use /watch on, /watch off, /watch <minutes> (2 to 720), /watch ai, or /watch rules.';
    const w = this.state.watch;
    return w.enabled ? `Email alerts are on. I check Gmail every ${w.intervalMin} minutes between ${this.watchStart}:00 and ${this.watchEnd}:00. Checks with no new mail use no AI. New mail is judged by ${w.mode === 'rules' ? 'simple rules (no AI at all)' : 'one short AI check'}. Send /watch rules or /watch ai to switch.` : 'Email alerts are off. Send /watch on to enable them.';
  }
  async setBriefing(arg) {
    const value = (arg || '').trim().toLowerCase();
    if (value === 'off') { this.state.briefing.time = null; await this.save(); return 'Morning briefing is off.'; }
    if (value) {
      const match = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
      let hour = match ? Number(match[1]) : NaN; const minute = match?.[2] ? Number(match[2]) : 0;
      if (match?.[3] === 'pm' && hour < 12) hour += 12;
      if (match?.[3] === 'am' && hour === 12) hour = 0;
      if (!match || hour > 23 || minute > 59) return 'Use /briefing 08:00, /briefing 7:30am, or /briefing off.';
      this.state.briefing.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      // Do not fire immediately for a time that already passed today.
      if (this.minutesNow() >= hour * 60 + minute) this.state.briefing.lastDate = this.today();
      await this.save();
    }
    return this.state.briefing.time ? `Daily briefing is scheduled for ${this.state.briefing.time}. Send /briefing off to stop it.` : 'Scheduled briefing is off. Send /briefing any time to get one now.';
  }
  status() {
    const w = this.state.watch, b = this.state.briefing;
    return `Email alerts: ${w.enabled ? `on, every ${w.intervalMin} min, ${w.mode === 'rules' ? 'rules' : 'AI'} filter` : 'off'}. Briefing: ${b.time ? 'daily at ' + b.time : 'on request'}. Reminders: ${this.state.reminders.length}.`;
  }

  // ----- scheduler -----
  localParts(date = this.now()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: this.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
    return parts;
  }
  today() { const p = this.localParts(); return `${p.year}-${p.month}-${p.day}`; }
  minutesNow() { const p = this.localParts(); return Number(p.hour) * 60 + Number(p.minute); }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.fireReminders();
      await this.deliverOutbox();
      if (!this.background) {
        if (await this.maybeBriefing()) return;
        await this.maybeCheckEmail();
      }
    } catch { console.error('Assistant scheduler error. Details hidden.'); }
    finally { this.ticking = false; }
  }
  async fireReminders() {
    const now = this.now().getTime();
    for (const reminder of this.state.reminders.filter(r => new Date(r.at).getTime() <= now && (!r.retryAt || new Date(r.retryAt).getTime() <= now))) {
      const late = now - new Date(reminder.at).getTime() > 10 * 60000;
      try {
        await this.send(`Reminder: ${reminder.text}${late ? `\n(Scheduled for ${formatWhen(new Date(reminder.at), this.timeZone)}; delivered late because the Mac was offline or asleep.)` : ''}`);
        this.state.reminders = this.state.reminders.filter(r => r.id !== reminder.id);
      } catch {
        reminder.attempts = (reminder.attempts || 0) + 1;
        if (reminder.attempts >= 10) this.state.reminders = this.state.reminders.filter(r => r.id !== reminder.id);
        else reminder.retryAt = new Date(now + 60000 * reminder.attempts).toISOString();
      }
      await this.save();
    }
  }
  // Outbox: Aside routines drop files in state/outbox to text the owner.
  // name.txt = plain text, send now. name.json = { text, at?, expiresAt? } (ISO times).
  // Writers should write name.tmp and rename, so half-written files are never sent.
  async deliverOutbox() {
    let names;
    try { names = (await fs.readdir(this.outboxDir)).filter(n => /\.(txt|json)$/.test(n)).sort(); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const now = this.now().getTime();
    for (const name of names) {
      const file = path.join(this.outboxDir, name);
      let item;
      try {
        const raw = await fs.readFile(file, 'utf8');
        item = name.endsWith('.json') ? JSON.parse(raw) : { text: raw };
      } catch { console.error('Outbox item unreadable, removed.'); await fs.unlink(file).catch(() => {}); continue; }
      const text = String(item?.text || '').trim();
      const due = item.at ? Date.parse(item.at) : now, expires = item.expiresAt ? Date.parse(item.expiresAt) : Infinity;
      if (!text || Number.isNaN(due)) { await fs.unlink(file).catch(() => {}); continue; }
      if (due > now) continue;
      if (expires <= now) { await fs.unlink(file).catch(() => {}); continue; } // stale (e.g. meeting already started)
      try { await this.send(text); }
      catch { console.error('Outbox send failed; will retry.'); return; }
      await fs.unlink(file).catch(() => {});
      this.state.notices = [...this.state.notices, { at: new Date(now).toISOString(), text: text.slice(0, 1500), used: false }].slice(-10);
      await this.save();
    }
  }
  // Recent proactive texts, so a reply like "yes" reaches Aside with what it answers.
  async contextFor(prompt) {
    const now = this.now().getTime();
    const recent = this.state.notices.filter(n => !n.used && now - Date.parse(n.at) < 12 * 3600000);
    if (!recent.length) return prompt;
    recent.forEach(n => { n.used = true; }); await this.save();
    const fmt = iso => new Intl.DateTimeFormat('en-GB', { timeZone: this.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
    return `[Context from the iMessage bridge: your scheduled routines recently texted me this. My message below may be a reply to it.]\n${recent.map(n => `(${fmt(n.at)}) ${n.text}`).join('\n---\n')}\n[End of context]\n\n${prompt}`;
  }
  async maybeBriefing() {
    const b = this.state.briefing;
    if (!b.time || b.lastDate === this.today()) return false;
    const [h, m] = b.time.split(':').map(Number), due = h * 60 + m, nowMin = this.minutesNow();
    if (nowMin < due) return false;
    b.lastDate = this.today(); await this.save();
    if (nowMin - due > 180) return false; // Mac was off all morning: skip a stale briefing.
    const text = await this.runBackground(this.briefingPrompt());
    if (text) await this.send('Good morning. Here is your briefing:\n\n' + text + this.remindersToday()).catch(() => {});
    return true;
  }
  async maybeCheckEmail() {
    const w = this.state.watch;
    if (!w.enabled) return;
    const hour = Math.floor(this.minutesNow() / 60);
    if (hour < this.watchStart || hour >= this.watchEnd) return;
    if (this.now() - new Date(w.lastCheck) < w.intervalMin * 60000) return;
    const startedAt = this.now();
    const since = new Date(w.lastCheck).getTime() - 5 * 60000; // overlap for delivery delay; dedup below
    // Step 1, zero AI tokens: plain Gmail lookup through Aside's REPL.
    const output = await this.runRepl(gmailSearchCode(this.gmailUid, Math.floor(since / 1000)));
    const list = output === null ? null : parseEmails(output);
    if (!list) { this.failures = (this.failures || 0) + 1; if (this.failures === 3) console.error('Gmail check failing repeatedly. Check that Gmail works in Aside.'); return; }
    this.failures = 0;
    const seen = new Set(w.seen || []);
    const fresh = list.filter(m => !seen.has(emailKey(m)) && new Date(m.at).getTime() >= since);
    w.lastCheck = startedAt.toISOString();
    if (!fresh.length) { await this.save(); return; } // nothing new: done, no tokens used
    // Step 2: only new candidates are judged, by rules (free) or one short AI call.
    let picks;
    if (w.mode === 'rules') picks = fresh.map((m, index) => ({ index, reason: '' })).filter(p => ruleImportant(fresh[p.index]));
    else {
      const verdict = await this.runBackground(classifyPrompt(fresh));
      if (verdict === null) { w.lastCheck = new Date(since + 5 * 60000).toISOString(); await this.save(); return; } // retry next time
      picks = /^\s*NONE\s*$/i.test(verdict) ? [] : parseClassification(verdict, fresh.length);
    }
    w.seen = [...(w.seen || []), ...fresh.map(emailKey)].slice(-1000);
    await this.save();
    if (picks.length) await this.send(formatAlert(fresh, picks)).catch(() => {});
  }
  async runRepl(code) {
    this.background = true;
    try { return await this.bridge.runRepl(code); } finally { this.background = false; }
  }
  briefingPrompt() {
    return `Give me a short briefing for today (${this.today()}, time zone ${this.timeZone})${this.account()}. Include: 1) today's Google Calendar events with start times, 2) important unread emails from the last 24 hours that need my attention, 3) anything urgent or due today. This is read-only: do not send, modify, archive, accept, or delete anything. Reply in short plain text without markdown.`;
  }
  remindersToday() {
    const today = this.today();
    const list = this.state.reminders.filter(r => { const p = this.localParts(new Date(r.at)); return `${p.year}-${p.month}-${p.day}` === today; });
    return list.length ? '\n\nYour reminders today:\n' + list.map(r => `${formatWhen(new Date(r.at), this.timeZone)}: ${r.text}`).join('\n') : '';
  }
  account() { return this.accountHint ? ` (Google account: ${this.accountHint})` : ''; }
  async runBackground(prompt) {
    this.background = true;
    try { return await this.bridge.runBackground(prompt); } finally { this.background = false; }
  }
}
