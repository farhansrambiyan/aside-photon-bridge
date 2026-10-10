export function textOf(content) {
  if (content?.type === 'text') return content.text;
  if (content?.type === 'reply') return textOf(content.content);
  if (content?.type === 'group' && Array.isArray(content.items)) {
    return content.items.map(textOf).filter(Boolean).join('\n');
  }
  return undefined;
}
export function normalizePhoton(space, message, imessage) {
  if (message.platform !== 'imessage' || message.direction !== 'inbound') return undefined;
  const text = textOf(message.content);
  if (!text) return undefined;
  const senderId = message.sender?.id;
  let kind;
  try { kind = imessage(space).type; } catch { return undefined; }
  return {
    senderId, spaceId: space.id, messageId: message.id, text,
    isDirect: kind === 'dm',
    reply: async response => {
      // Plain conversation send, not native threaded replies. No automatic retries.
      const sent = await space.send(response);
      if (!sent) throw new Error('Photon did not accept the reply.');
    },
  };
}
