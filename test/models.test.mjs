import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, findModel, formatModels, modelName } from '../src/models.mjs';
test('model lookup by number, provider/id, unique id and name', () => {
  assert.equal(findModel('1'), MODELS[0]);
  assert.equal(findModel('0'), null);
  assert.equal(findModel('aside/claude-sonnet-5').provider, 'aside');
  assert.equal(findModel('claude-sonnet-5'), null); // ambiguous across providers
  assert.equal(findModel('grok-4.7').modelId, 'grok-4.7');
  assert.equal(findModel('GPT-6.1 Sol').modelId, 'gpt-6.1-sol');
  assert.equal(findModel(''), null);
});
test('model list is grouped and numbered', () => {
  const out = formatModels({ provider: 'aside', modelId: 'grok-4.7' });
  assert.match(out, /^Claude subscription:\n1\. /);
  assert.match(out, /\nAside:\n15\. GPT-6\.1 Sol/);
  assert.match(out, /Grok 4\.7 \(current\)/);
  assert.equal(modelName({ provider: 'x', modelId: 'y' }), 'x/y');
});
