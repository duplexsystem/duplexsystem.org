// @license magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt AGPL-3.0-or-later
// Tidies search results.
//
// rehype/search-names.mjs gives every emoji a `title` with its Unicode name and
// asks Pagefind to index that attribute, which is what makes "trans" find 🏳️‍⚧️.
// Pagefind then splices the attribute value into the excerpt text as well, so a
// result reads `<mark>transgender</mark> flag. 🏳️‍⚧️.`: the machinery leaking
// into the page.
//
// This collapses each `NAME. EMOJI.` pair back down to the emoji, and carries
// any highlight across: if the name matched the query, the emoji gets the
// <mark> instead. Searching "trans" therefore highlights the flag itself.
//
// Math is indexed the same way and fenced, so its terms are removed outright:
// a reader wants the equation, not the words that found it.
//
// Progressive enhancement. With this file blocked the results are still correct
// and still complete: just noisier.
(() => {
  const el = document.getElementById('emoji-names');
  if (!el) return;

  let names;
  try {
    names = JSON.parse(el.textContent);
  } catch {
    return;
  }
  if (!names || !Object.keys(names).length) return;

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const patterns = Object.entries(names).map(([emoji, name]) => {
    const words = name.split(' ').map(escape).join('(?:</?mark>|\\s)+');
    return {
      emoji,
      re: new RegExp(
        `(?:<mark>)?${words}\\.?(?:</mark>)?\\.?[ \\t]*(?:<mark>)?${escape(emoji)}(?:</mark>)?([.,;:!?])?`,
        'gi',
      ),
    };
  });

  // A character no KaTeX font draws, so it cannot appear in a real equation.
  const FENCED = /\u00a4(?:<\/?mark>|[^\u00a4])*\u00a4[ \t]*\.?[ \t]*/g;

  function tidy(html) {
    let out = html.replace(FENCED, '');
    for (const { emoji, re } of patterns) {
      out = out.replace(re, (match, punct = '') =>
        /<mark>/i.test(match) ? `<mark>${emoji}${punct}</mark>` : `${emoji}${punct}`,
      );
    }
    return out;
  }

  // Pagefind cannot tokenize newer emoji or ZWJ sequences, so an all-emoji
  // query is expanded to the names, which are indexed. Scoped to all-emoji
  // input: expanding mid-sentence would rewrite the box while someone types.
  const input = document.querySelector('pagefind-input input');
  const byLength = Object.keys(names).sort((a, b) => b.length - a.length);
  if (input) {
    const allEmoji = new RegExp(`^(?:\\s|${byLength.map(escape).join('|')})+$`, 'u');
    let expanding = false;

    input.addEventListener('input', () => {
      if (expanding) return;
      const q = input.value.trim();
      if (!q || !allEmoji.test(q)) return;
      let rest = q;
      const found = [];
      for (const e of byLength) {
        if (!rest.includes(e)) continue;
        rest = rest.split(e).join(' ');
        found.push(names[e]);
      }
      if (!found.length) return;

      expanding = true;
      input.value = `${q} ${found.join(' ')}`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expanding = false;
    });
  }

  function markQueryEmoji(root) {
    const q = input?.value ?? '';
    if (!q) return;
    const present = byLength.filter((e) => q.includes(e));
    if (!present.length) return;

    const re = new RegExp(`(${present.map(escape).join('|')})`, 'gu');
    for (const node of root.querySelectorAll('[class*="excerpt"]')) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const targets = [];
      let n;
      while ((n = walker.nextNode())) {
        if (n.parentElement?.closest('mark')) continue;
        if (present.some((e) => n.nodeValue.includes(e))) targets.push(n);
      }
      for (const target of targets) {
        const frag = document.createDocumentFragment();
        for (const part of target.nodeValue.split(re)) {
          if (!part) continue;
          if (present.includes(part)) {
            const m = document.createElement('mark');
            m.textContent = part;
            frag.append(m);
          } else {
            frag.append(document.createTextNode(part));
          }
        }
        target.replaceWith(frag);
      }
    }
  }

  function sweep(root) {
    for (const node of root.querySelectorAll('[class*="excerpt"]')) {
      if (node.dataset.emojiTidied === '1') continue;
      const next = tidy(node.innerHTML);
      if (next !== node.innerHTML) node.innerHTML = next;
      node.dataset.emojiTidied = '1';
    }
    markQueryEmoji(root);
  }

  const results = document.querySelector('pagefind-results') ?? document.body;
  new MutationObserver(() => sweep(results)).observe(results, {
    childList: true,
    subtree: true,
  });
  sweep(results);
})();
// @license-end
