import * as chrono from 'chrono-node';

const trigger = /^(?:hey\s+|hi\s+)?(?:please\s+|pls\s+)?(?:can you\s+|could you\s+)?(?:remind me|set (?:a |an )?reminder|reminder)\b[\s,:-]*/i;
const periods = [[/\bmorning\b/i, 9], [/\bafternoon\b/i, 14], [/\bevening\b/i, 18], [/\btonight\b/i, 20], [/\bnight\b/i, 21], [/\bnoon\b/i, 12]];

export function isReminderRequest(text) { return trigger.test(text.trim()); }

// Returns { at: Date, text } | { error }. Pure and deterministic for testing.
export function parseReminder(input, now = new Date()) {
  const body = input.trim().replace(trigger, '');
  if (/\b(?:every|daily|weekly|each (?:day|week|morning))\b/i.test(body)) {
    return { error: 'Repeating reminders are not supported yet. For a daily summary, use /briefing 08:00.' };
  }
  const [hit] = chrono.parse(body, now, { forwardDate: true });
  if (!hit) return { error: 'I could not find a time. Try: remind me tomorrow morning to call mom, or remind me in 2 hours to check the oven.' };
  const at = hit.start.date();
  if (!hit.start.isCertain('hour')) {
    const period = periods.find(([pattern]) => pattern.test(hit.text));
    at.setHours(period ? period[1] : 9, 0, 0, 0);
  } else if (!hit.start.isCertain('minute')) at.setMinutes(0, 0, 0);
  else at.setSeconds(0, 0);
  // "this morning" said in the afternoon must not silently become tomorrow.
  if (/\b(?:this|today|tonight)\b/i.test(hit.text) && at.toDateString() !== now.toDateString()) return { error: 'That time has already passed. Please give a future time.' };
  if (at.getTime() <= now.getTime() + 30000) return { error: 'That time has already passed. Please give a future time.' };
  if (at.getTime() - now.getTime() > 366 * 864e5) return { error: 'Reminders can be at most one year ahead.' };
  let text = (body.slice(0, hit.index) + ' ' + body.slice(hit.index + hit.text.length))
    .replace(/\s+/g, ' ').trim()
    .replace(/^(?:to|about|that|of|for)\s+/i, '').replace(/\s+(?:at|on|by|in)$/i, '').replace(/^[,.:;-]+|[,.:;-]+$/g, '').trim();
  if (!text) text = 'You asked me to remind you now.';
  return { at, text: text.slice(0, 500) };
}

export function formatWhen(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(date);
}
