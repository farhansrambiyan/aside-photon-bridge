import test from 'node:test';
import assert from 'node:assert/strict';
import { plainReply } from '../src/plain-text.mjs';
test('removes headings, bold, emphasis, inline code and fences', () => {
  const input = '# Result\n\n**Done** and *ready*. Use `npm start`.\n\n```bash\necho hello\n```';
  assert.equal(plainReply(input), 'Result\n\nDone and ready. Use npm start.\n\necho hello');
});
test('links retain labels and readable URLs', () => {
  assert.equal(plainReply('[Open page](https://example.com)'), 'Open page: https://example.com');
});
test('tables turn into readable field-value text', () => {
  assert.equal(plainReply('| Item | Price |\n| --- | --- |\n| Tea | $5 |'), 'Item: Tea; Price: $5');
});
test('hides actual session IDs and repeated diagnostic labels', () => {
  const result = plainReply('**session_id:** example-internal-id\n\nDone. Internal example-internal-id.', ['example-internal-id']);
  assert.equal(result.includes('example-internal-id'), false);
  assert.equal(/session[_\s-]*id/i.test(result), false);
  assert.equal(result.includes('Done.'), true);
});
test('ordinary text, math, URL and shell commands are preserved', () => {
  assert.equal(plainReply('Cost is $5. 2 * 3 = 6.\n\nhttps://example.com\n\necho "hello"'), 'Cost is $5. 2 * 3 = 6.\n\nhttps://example.com\n\necho "hello"');
});
