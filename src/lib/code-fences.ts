export function hasCodeBlock(markdown: string): boolean {
  let open: { ch: string; len: number } | null = null;
  for (const line of markdown.split('\n')) {
    const m = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (!m) continue;
    const [, fence, lang] = m;
    if (open) {
      if (fence[0] === open.ch && fence.length >= open.len && !lang) open = null;
      continue;
    }
    if (lang !== 'flowchart') return true;
    open = { ch: fence[0], len: fence.length };
  }
  return false;
}
