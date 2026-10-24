const RE = /\^([^\s^]+)\^|~([^\s~]+)~/g;

export function supsubSegments(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(RE)) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { type: 'sup', value: m[1] } : { type: 'sub', value: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

export function supsubPlain(text) {
  return text.replace(RE, (_, sup, sub) => sup ?? sub);
}

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function captionHtml(text) {
  return text
    .split(/(`[^`]+`)/)
    .map((part) =>
      /^`[^`]+`$/.test(part) ? `<code>${escapeHtml(part.slice(1, -1))}</code>` : supsubHtml(part),
    )
    .join('');
}

export function supsubHtml(text) {
  return supsubSegments(text)
    .map((s) =>
      s.type === 'text' ? escapeHtml(s.value) : `<${s.type}>${escapeHtml(s.value)}</${s.type}>`,
    )
    .join('');
}
