export function textOf(content) {
  if (content?.type === 'text') return content.text;
  if (content?.type === 'reply') return textOf(content.content);
  if (content?.type === 'group' && Array.isArray(content.items)) {
    return content.items.map(textOf).filter(Boolean).join('\n');
  }
  return undefined;
}
// Contact cards cannot be read; photos, videos, files and voice notes can (see mediaItems).
const UNREADABLE = new Set(['contact']);
export function mediaKind(content) {
  if (content?.type === 'reply') return mediaKind(content.content);
  if (UNREADABLE.has(content?.type)) return content.type;
  if (content?.type === 'group' && Array.isArray(content.items)) return content.items.map(mediaKind).find(Boolean);
  return undefined;
}
// Downloadable attachments (lazy: nothing is fetched until the bridge asks).
export function mediaItems(content) {
  if (content?.type === 'reply') return mediaItems(content.content);
  if (content?.type === 'group' && Array.isArray(content.items)) return content.items.flatMap(mediaItems);
  if ((content?.type === 'attachment' || content?.type === 'voice') && typeof content.read === 'function') {
    return [{ type: content.type, name: content.name, mimeType: content.mimeType, size: content.size, read: () => content.read() }];
  }
  return [];
}
// A native iMessage reply: which message was swiped, and what it said.
export function replyInfo(content) {
  if (content?.type !== 'reply') return {};
  const target = content.target;
  const quoted = textOf(target?.content);
  return { replyTo: typeof target?.id === 'string' ? target.id : undefined, quoted: typeof quoted === 'string' ? quoted : undefined };
}
export function normalizePhoton(space, message, imessage) {
  if (message.platform !== 'imessage' || message.direction !== 'inbound') return undefined;
  const text = textOf(message.content);
  const media = mediaItems(message.content);
  const unsupported = text || media.length ? undefined : mediaKind(message.content);
  if (!text && !media.length && !unsupported) return undefined; // reactions, receipts, group events: ignore
  const senderId = message.sender?.id;
  let kind;
  try { kind = imessage(space).type; } catch { return undefined; }
  return {
    senderId, spaceId: space.id, messageId: message.id, text: text || '', unsupported, media,
    isDirect: kind === 'dm',
    ...replyInfo(message.content),
    reply: async response => {
      // Plain conversation send. No automatic retries. Returns the sent message id so
      // a later swipe-reply to it can continue the right conversation.
      const sent = await space.send(response);
      if (!sent) throw new Error('Photon did not accept the reply.');
      return typeof sent.id === 'string' ? sent.id : undefined;
    },
    typing: { start: () => space.startTyping(), stop: () => space.stopTyping() },
    markRead: () => space.read(message),
  };
}
