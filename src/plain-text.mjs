import { marked } from 'marked';

function render(tokens = []) {
  return tokens.map(token => {
    switch (token.type) {
      case 'space': return '\n';
      case 'heading':
      case 'paragraph': return render(token.tokens) + '\n\n';
      case 'text': return token.tokens ? render(token.tokens) : token.text || '';
      case 'strong': case 'em': case 'del': return render(token.tokens);
      case 'escape': case 'codespan': return token.text || '';
      case 'code': return (token.text || '') + '\n\n';
      case 'br': return '\n';
      case 'hr': return '\n';
      case 'blockquote': return render(token.tokens) + '\n';
      case 'link': {
        const label = render(token.tokens), url = token.href || '';
        return label === url || !label ? url : `${label}: ${url}`;
      }
      case 'image': return token.text ? `${token.text}: ${token.href}` : token.href || '';
      case 'list': return token.items.map((item, i) => {
        const prefix = token.ordered ? `${Number(token.start || 1) + i}. ` : '• ';
        const checked = item.task ? (item.checked ? 'Done: ' : 'To do: ') : '';
        return prefix + checked + render(item.tokens).trim();
      }).join('\n') + '\n\n';
      case 'table': {
        const headers = token.header.map(cell => render(cell.tokens).trim());
        return token.rows.map(row => row.map((cell, i) => `${headers[i]}: ${render(cell.tokens).trim()}`).join('; ')).join('\n') + '\n\n';
      }
      case 'html': return (token.text || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n').replace(/<[^>]*>/g, '');
      default: return token.tokens ? render(token.tokens) : token.text || '';
    }
  }).join('');
}
function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, name) => {
    if (name[0] !== '#') return named[name.toLowerCase()] || whole;
    const value = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : whole;
  });
}
export function plainReply(value, sessionIds = []) {
  let text = String(value ?? '');
  // Hide exact internal IDs wherever they appear, before formatting.
  for (const id of sessionIds.filter(Boolean)) text = text.split(id).join('[hidden]');
  try { text = render(marked.lexer(text, { gfm: true })); } catch { /* Keep a usable reply on parser errors. */ }
  text = decodeEntities(text);
  // Remove diagnostic session labels too, even if an answer repeats them.
  text = text.replace(/\bsession(?:[_\s-]*id)\s*[:=]\s*["']?[^\s"'`,;]+["']?/gi, '')
    .replace(/\bsession(?:[_\s-]*id)\s+(?:is\s+)?["']?(?:[A-Za-z0-9_-]{8,128}|\[hidden\])["']?/gi, '')
    .replace(/\bses_[A-Za-z0-9_-]+\b/g, '[hidden]');
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
