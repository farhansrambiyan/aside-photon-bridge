import test from 'node:test';
import assert from 'node:assert/strict';
import { servicePlist } from '../src/service-plist.mjs';
test('service starts at login, keeps running and uses background supervisor', () => {
  const xml = servicePlist('/path/a&b', '/node');
  assert.match(xml, /<key>RunAtLoad<\/key><true\/>/); assert.match(xml, /<key>KeepAlive<\/key><true\/>/);
  assert.match(xml, /src\/service\.mjs/); assert.match(xml, /\/path\/a&amp;b/);
  assert.doesNotMatch(xml, /SPECTRUM_PROJECT_SECRET/);
});
