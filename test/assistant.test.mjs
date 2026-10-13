import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../src/config.mjs';
import { parseReminder, isReminderRequest } from '../src/reminders.mjs';
import { Assistant } from '../src/assistant.mjs';
import { Bridge } from '../src/bridge.mjs';

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m); // local time, Oct 2026

test('reminder phrases are detected', () => {
  for (const t of ['remind me tomorrow morning to call mom', 'Please remind me in 2 hours', 'set a reminder for 5pm: pay rent', 'Reminder: dentist friday 10am']) assert.equal(isReminderRequest(t), true, t);
  for (const t of ['what reminders do I have in gmail', 'check my email', 'did you remind him']) assert.equal(isReminderRequest(t), false, t);
});
test('tomorrow morning means 9:00 next day and keeps the task text', () => {
  const r = parseReminder('remind me tomorrow morning to call mom', at(10, 15));
  assert.deepEqual([r.at.getDate(), r.at.getHours(), r.at.getMinutes()], [11, 9, 0]); assert.equal(r.text, 'call mom');
});
test('relative, explicit and period times', () => {
  let r = parseReminder('remind me in 2 hours to check the oven', at(10, 15, 7));
  assert.deepEqual([r.at.getHours(), r.at.getMinutes()], [17, 7]); assert.equal(r.text, 'check the oven');
  r = parseReminder('remind me to pay rent at 5pm', at(10, 15)); assert.deepEqual([r.at.getDate(), r.at.getHours()], [10, 17]); assert.equal(r.text, 'pay rent');
  r = parseReminder('remind me at 8am to stretch', at(10, 15)); assert.deepEqual([r.at.getDate(), r.at.getHours()], [11, 8]);
  r = parseReminder('remind me tomorrow evening about the report', at(10, 15)); assert.deepEqual([r.at.getDate(), r.at.getHours()], [11, 18]); assert.equal(r.text, 'the report');
  r = parseReminder('remind me tomorrow to submit form', at(10, 15)); assert.deepEqual([r.at.getDate(), r.at.getHours()], [11, 9]);
});
test('missing time, recurring and past times are refused clearly', () => {
  assert.match(parseReminder('remind me to call mom', at(10, 15)).error, /could not find a time/);
  assert.match(parseReminder('remind me every day at 8am to stretch', at(10, 15)).error, /Repeating/);
  assert.match(parseReminder('remind me this morning to stretch', at(10, 15)).error, /already passed/);
});

async function setup(runImpl, now, gmailImpl = () => []) {
  const stateDir = await fs.mkdtemp(path.join(root, 'test', '.state-'));
  const sent = [], prompts = [];
  const repl = [];
  const mcp = { ready: true, run: async (prompt, s) => { prompts.push({ prompt, s }); return runImpl(prompt); }, close() {}, connect: async () => {},
    request: async (method, params) => { repl.push(params.arguments.code); const list = gmailImpl(); if (list === null) throw new Error('down'); return { content: [{ type: 'text', text: 'log\n__ASIDE_BRIDGE_EMAILS__' + JSON.stringify(list) }] }; } };
  const bridge = new Bridge({ mcp, allowedSenders: new Set(['owner']), stateDir });
  const clock = { now };
  const assistant = new Assistant({ bridge, stateDir, timeZone: tz, now: () => clock.now, send: async t => { sent.push(t); } });
  bridge.assistant = assistant;
  await assistant.load();
  return { bridge, assistant, sent, prompts, repl, clock, cleanup: () => fs.rm(stateDir, { recursive: true, force: true }) };
}

test('reminder fires once at its time and survives restart', async () => {
  const f = await setup(() => ({ text: 'x', sessionId: 's' }), at(10, 15));
  try {
    f.assistant.state.watch.enabled = false; f.assistant.state.briefing.time = null;
    assert.match(await f.assistant.addReminder('remind me in 10 minutes to stand up'), /Got it/);
    const reloaded = new Assistant({ bridge: f.bridge, stateDir: f.assistant.stateDir, timeZone: tz, now: () => f.clock.now, send: async t => f.sent.push(t) });
    await reloaded.load(); reloaded.state.watch.enabled = false; reloaded.state.briefing.time = null;
    await reloaded.tick(); assert.equal(f.sent.length, 0);
    f.clock.now = at(10, 15, 11); await reloaded.tick(); await reloaded.tick();
    assert.deepEqual(f.sent, ['Reminder: stand up']); assert.equal(reloaded.state.reminders.length, 0);
  } finally { await f.cleanup(); }
});
test('list and cancel reminders', async () => {
  const f = await setup(() => ({ text: 'x' }), at(10, 15));
  try {
    await f.assistant.addReminder('remind me tomorrow at 10am to A'); await f.assistant.addReminder('remind me in 1 hour to B');
    assert.match(f.assistant.listReminders(), /1\. .*B\n2\. .*A/);
    assert.match(await f.assistant.cancelReminder('1'), /Cancelled: B/); assert.equal(f.assistant.state.reminders.length, 1);
    assert.match(await f.assistant.cancelReminder('9'), /\/reminders/);
  } finally { await f.cleanup(); }
});
const mail = (id, minute, extra = {}) => ({ id, at: at(10, 10, minute).toISOString(), subject: 'Subject ' + id, snippet: 'preview', name: 'Person ' + id, email: id + '@example.com', unread: true, ...extra });
test('no new mail costs zero AI calls; new mail gets one short classification; repeats are not re-sent', async () => {
  let inbox = [], verdict = 'NONE';
  const f = await setup(() => ({ text: verdict, sessionId: 'bg' }), at(10, 10), () => inbox);
  try {
    f.assistant.state.briefing.time = null;
    f.clock.now = at(10, 10, 6); await f.assistant.tick();
    assert.equal(f.repl.length, 1); assert.equal(f.prompts.length, 0); assert.equal(f.sent.length, 0);
    assert.match(f.repl[0], /gmail\.search\(0, "in:inbox after:\d+ -category:promotions/);
    inbox = [mail('a', 7), mail('b', 8)]; verdict = '2 | needs your signature today';
    f.clock.now = at(10, 10, 12); await f.assistant.tick();
    assert.equal(f.prompts.length, 1); assert.equal(f.prompts[0].s, undefined);
    assert.match(f.prompts[0].prompt, /untrusted data/); assert.match(f.prompts[0].prompt, /Person a/);
    assert.deepEqual(f.sent, ['Important email:\n- Person b: Subject b (needs your signature today)']);
    f.clock.now = at(10, 10, 18); await f.assistant.tick(); // same two emails again
    assert.equal(f.prompts.length, 1); assert.equal(f.sent.length, 1);
  } finally { await f.cleanup(); }
});
test('classifier output cannot inject text: only valid numbers map to our own sender/subject', async () => {
  const { parseClassification, formatAlert } = await import('../src/email-filter.mjs');
  const list = [mail('a', 1), mail('b', 2)];
  const picks = parseClassification('Sure!\n9 | fake\n1 | real reason\nVisit evil.example now\n1 | dup', 2);
  assert.deepEqual(picks, [{ index: 0, reason: 'real reason' }]);
  assert.equal(formatAlert(list, picks), 'Important email:\n- Person a: Subject a (real reason)');
});
test('rules mode uses no AI at all', async () => {
  const inbox = [mail('news', 7, { email: 'no-reply@shop.example', subject: 'Big sale' }), mail('bank', 8, { email: 'alerts@bank.example', subject: 'Payment failed for your card' }), mail('friend', 9, { email: 'friend@gmail.com' })];
  const f = await setup(() => { throw new Error('AI should not run'); }, at(10, 10), () => inbox);
  try {
    f.assistant.state.briefing.time = null; await f.assistant.setWatch('rules');
    f.clock.now = at(10, 10, 12); await f.assistant.tick();
    assert.equal(f.prompts.length, 0);
    assert.match(f.sent[0], /Person bank: Payment failed/); assert.match(f.sent[0], /Person friend/); assert.doesNotMatch(f.sent[0], /Big sale/);
  } finally { await f.cleanup(); }
});
test('email watch respects quiet hours and Gmail failures do not lose mail', async () => {
  let inbox = null;
  const f = await setup(() => ({ text: '1 | urgent' }), at(10, 23), () => inbox);
  try {
    f.assistant.state.briefing.time = null; f.assistant.state.watch.lastCheck = at(10, 20).toISOString();
    await f.assistant.tick(); assert.equal(f.repl.length, 0); // 23:00 is outside 8-22
    f.clock.now = at(11, 9); const before = f.assistant.state.watch.lastCheck;
    await f.assistant.tick(); assert.equal(f.repl.length, 1); assert.equal(f.assistant.state.watch.lastCheck, before);
    inbox = [{ ...mail('late', 0), at: at(10, 21).toISOString() }];
    f.clock.now = at(11, 9, 6); await f.assistant.tick();
    assert.match(f.sent[0], /Person late/);
  } finally { await f.cleanup(); }
});
test('scheduled briefing (only if explicitly set) runs once per day and includes today reminders', async () => {
  const f = await setup(() => ({ text: '10:00 Standup', sessionId: 'b' }), at(10, 7, 59));
  try {
    f.assistant.state.watch.enabled = false; f.assistant.state.briefing.time = '08:00';
    await f.assistant.addReminder('remind me today at 6pm to buy milk');
    await f.assistant.tick(); assert.equal(f.sent.length, 0);
    f.clock.now = at(10, 8, 1); await f.assistant.tick(); await f.assistant.tick();
    assert.equal(f.sent.length, 1); assert.match(f.sent[0], /Good morning/); assert.match(f.sent[0], /10:00 Standup/); assert.match(f.sent[0], /buy milk/);
    assert.match(f.prompts[0].prompt, /Calendar/);
  } finally { await f.cleanup(); }
});
test('stale briefing is skipped if the Mac was off all morning; settings commands validate', async () => {
  const f = await setup(() => ({ text: 'x' }), at(10, 13));
  try {
    f.assistant.state.watch.enabled = false; f.assistant.state.briefing.time = '08:00'; await f.assistant.tick(); assert.equal(f.sent.length, 0);
    assert.match(await f.assistant.setBriefing('7:30am'), /07:30/); assert.match(await f.assistant.setBriefing('25:00'), /Use \/briefing/);
    assert.match(await f.assistant.setBriefing('off'), /off/);
    assert.match(await f.assistant.setWatch('off'), /off/); assert.match(await f.assistant.setWatch('15'), /every 15 minutes/); assert.match(await f.assistant.setWatch('1'), /2 to 720/);
  } finally { await f.cleanup(); }
});
test('bridge handles reminder messages locally without running a browser task', async () => {
  const f = await setup(() => ({ text: 'should not run' }), at(10, 15));
  try {
    const replies = []; let n = 0;
    const msg = text => ({ senderId: 'owner', spaceId: 'dm', messageId: String(++n), text, isDirect: true, reply: async r => replies.push(r) });
    await f.bridge.handle(msg('Remind me tomorrow morning to call mom'));
    await f.bridge.handle(msg('/reminders')); await f.bridge.handle(msg('/watch'));
    assert.equal(f.prompts.length, 0);
    assert.match(replies[0], /Got it\. I'll remind you .*: call mom/); assert.match(replies[1], /call mom/); assert.match(replies[2], /Email alerts are on/);
  } finally { await f.cleanup(); }
});

test('no briefing is ever sent automatically by default', async () => {
  const f = await setup(() => ({ text: 'Calendar' }), at(10, 8, 30));
  try {
    f.assistant.state.watch.enabled = false; assert.equal(f.assistant.state.briefing.time, null);
    for (const h of [8, 9, 12]) { f.clock.now = at(10, h, 30); await f.assistant.tick(); }
    assert.equal(f.sent.length, 0); assert.equal(f.prompts.length, 0);
  } finally { await f.cleanup(); }
});
test('/briefing gives a briefing right away in chat', async () => {
  const f = await setup(() => ({ text: '**10:00** Standup', sessionId: 'b' }), at(10, 15));
  try {
    await f.assistant.addReminder('remind me today at 6pm to buy milk');
    const replies = [];
    await f.bridge.handle({ senderId: 'owner', spaceId: 'dm', messageId: 'b1', text: '/briefing', isDirect: true, reply: async r => replies.push(r) });
    assert.equal(f.prompts.length, 1); assert.match(f.prompts[0].prompt, /Calendar/); assert.equal(f.prompts[0].s, undefined);
    assert.match(replies.at(-1), /^10:00 Standup/); assert.match(replies.at(-1), /buy milk/);
  } finally { await f.cleanup(); }
});

test('outbox: due items are texted once, future items wait, expired items are dropped, replies get context', async () => {
  const f = await setup(() => ({ text: 'done', sessionId: 's1' }), at(10, 9));
  try {
    f.assistant.state.watch.enabled = false; f.assistant.state.briefing.time = null;
    const dir = f.assistant.outboxDir;
    await fs.writeFile(path.join(dir, 'a-ask.txt'), 'Can I check all the mails and summarise?');
    await fs.writeFile(path.join(dir, 'b-later.json'), JSON.stringify({ text: 'Meeting in 10 min', at: at(10, 9, 50).toISOString(), expiresAt: at(10, 10).toISOString() }));
    await fs.writeFile(path.join(dir, 'c-stale.json'), JSON.stringify({ text: 'old', at: at(10, 8).toISOString(), expiresAt: at(10, 8, 30).toISOString() }));
    await fs.writeFile(path.join(dir, 'd-partial.tmp'), 'ignored');
    await f.assistant.tick();
    assert.deepEqual(f.sent, ['Can I check all the mails and summarise?']);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['b-later.json', 'd-partial.tmp']);
    f.clock.now = at(10, 9, 51); await f.assistant.tick();
    assert.deepEqual(f.sent.slice(1), ['Meeting in 10 min']);
    await f.bridge.handle({ senderId: 'owner', spaceId: 'sp', messageId: 'm1', text: 'yes', isDirect: true, reply: async () => {} });
    assert.match(f.prompts.at(-1).prompt, /Can I check all the mails and summarise\?[\s\S]*Meeting in 10 min[\s\S]*\n\nyes$/);
    await f.bridge.handle({ senderId: 'owner', spaceId: 'sp', messageId: 'm2', text: 'thanks', isDirect: true, reply: async () => {} });
    assert.equal(f.prompts.at(-1).prompt, 'thanks');
  } finally { await f.cleanup(); }
});
