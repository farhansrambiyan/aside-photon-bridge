// Models offered by /models and /model. Snapshot of the Aside model catalog
// (Oct 2026). The CLI has no model-list API, so edit this list to add or
// remove entries. Order is the number shown in iMessage.
export const MODELS = [
  { provider: 'claude-code', modelId: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { provider: 'claude-code', modelId: 'claude-opus-5', name: 'Claude Opus 5' },
  { provider: 'claude-code', modelId: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
  { provider: 'claude-code', modelId: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
  { provider: 'claude-code', modelId: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
  { provider: 'claude-code', modelId: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
  { provider: 'claude-code', modelId: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { provider: 'claude-code', modelId: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
  { provider: 'claude-code', modelId: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { provider: 'claude-code', modelId: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
  { provider: 'claude-code', modelId: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
  { provider: 'claude-code', modelId: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  { provider: 'claude-code', modelId: 'claude-fable-5-1', name: 'Claude Fable 5.1' },
  { provider: 'claude-code', modelId: 'claude-fable-5', name: 'Claude Fable 5' },
  { provider: 'aside', modelId: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
  { provider: 'aside', modelId: 'gpt-6-luna', name: 'GPT-6 Luna' },
  { provider: 'aside', modelId: 'claude-sonnet-5', name: 'Claude Sonnet 5.5 (Aside)' },
  { provider: 'aside', modelId: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 (Aside)' },
  { provider: 'aside', modelId: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
  { provider: 'aside', modelId: 'grok-4.7', name: 'Grok 4.7' },
  { provider: 'aside', modelId: 'glm-5.3', name: 'GLM 5.3' },
  { provider: 'aside', modelId: 'glm-5.3-flash', name: 'GLM 5.3 Flash' },
  { provider: 'aside', modelId: 'kimi-k2.7-code', name: 'Kimi K2.7 Code' },
  { provider: 'aside', modelId: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
];

const providerLabel = provider => provider === 'claude-code' ? 'Claude subscription' : provider === 'aside' ? 'Aside' : provider;

// Accepts a list number, "provider/modelId", or a unique modelId / name.
export function findModel(query, models = MODELS) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  if (/^\d+$/.test(q)) return models[Number(q) - 1] || null;
  const exact = models.find(m => `${m.provider}/${m.modelId}`.toLowerCase() === q);
  if (exact) return exact;
  const matches = models.filter(m => m.modelId.toLowerCase() === q || m.name.toLowerCase() === q);
  return matches.length === 1 ? matches[0] : null;
}

export function formatModels(current, models = MODELS) {
  const lines = [];
  let group = null;
  models.forEach((m, i) => {
    if (m.provider !== group) { group = m.provider; lines.push((lines.length ? '\n' : '') + providerLabel(group) + ':'); }
    const active = current && current.provider === m.provider && current.modelId === m.modelId;
    lines.push(`${i + 1}. ${m.name}${active ? ' (current)' : ''}`);
  });
  return lines.join('\n');
}

export function modelName(model, models = MODELS) {
  if (!model?.modelId) return 'unknown';
  const known = models.find(m => m.provider === model.provider && m.modelId === model.modelId);
  return known ? known.name : `${model.provider}/${model.modelId}`;
}
