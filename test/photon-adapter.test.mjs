import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhoton, textOf } from '../src/photon-adapter.mjs';
test('extracts text and incoming threaded reply payload', () => {
  assert.equal(textOf({ type: 'reply', content: { type: 'text', text: '/aside test' } }), '/aside test');
  assert.equal(textOf({ type: 'attachment' }), undefined);
});
test('normalizes only inbound Photon iMessage and sends to original conversation', async () => {
  const sent = [];
  const space = { id: 'chat-guid', send: async text => { sent.push(text); return { id: 'sent' }; } };
  const message = { id: 'msg', platform: 'imessage', direction: 'inbound', sender: { id: '+123' }, content: { type: 'text', text: '/aside task' } };
  const event = normalizePhoton(space, message, () => ({ type: 'dm' }));
  assert.equal(event.senderId, '+123'); assert.equal(event.isDirect, true);
  await event.reply('result'); assert.deepEqual(sent, ['result']);
  assert.equal(normalizePhoton(space, { ...message, direction: 'outbound' }, () => ({ type: 'dm' })), undefined);
  assert.equal(normalizePhoton(space, message, () => ({ type: 'group' })).isDirect, false);
});
