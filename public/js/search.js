// @license magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt AGPL-3.0-or-later
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

  const FENCED = /\u00a4(?:<\/?mark>|[^\u00a4])*\u00a4[ \t]*\.?[ \t]*/g;

  function tidy(html) {
    let out = html.replace(FENCED, '');
    for (const { emoji, re } of patterns) {
      out = out.replace(re, (match, punct = '') =>
        /<mark>/i.test(match)
          ? `<mark class="pf-emoji">${emoji}</mark>${punct}`
          : `${emoji}${punct}`,
      );
    }
    return out;
  }

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
            m.className = 'pf-emoji';
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

(() => {
  const summary = document.querySelector('pagefind-summary');
  const box = () => document.querySelector('pagefind-input input');

  customElements.whenDefined('pagefind-input').then(() => {
    const input = box();
    if (!input) return;
    input.type = 'text';
    input.setAttribute('role', 'searchbox');
    input.enterKeyHint = 'search';
  });

  function split() {
    const el = summary.querySelector('.pf-summary');
    const input = box();
    if (!el || !input || el.querySelector('.pf-q')) return;
    const text = el.textContent;
    const q = input.value.trim();
    if (!q || !text.endsWith(q)) return;
    const query = document.createElement('span');
    query.className = 'pf-q';
    query.textContent = q;
    el.replaceChildren(text.slice(0, -q.length), query);
  }

  if (summary) {
    new MutationObserver(split).observe(summary, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    split();
  }

  const results = document.querySelector('pagefind-results');
  const panel = results?.closest('.pfresults');
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  let last = null;
  let lastCount = null;
  let held = null;
  let heldCount = null;
  let closing = 0;

  function stand(copy, parent) {
    copy.classList.add('pf-held');
    copy.inert = true;
    copy.setAttribute('aria-hidden', 'true');
    parent.append(copy);
    return copy;
  }

  function release() {
    held?.remove();
    heldCount?.remove();
    held = heldCount = null;
    delete panel.dataset.holding;
    delete panel.dataset.closing;
  }

  function close() {
    if (closing || !last || !lastCount || calm.matches) return;
    held ??= stand(last, results);
    heldCount = stand(lastCount, summary);
    last = lastCount = null;
    panel.dataset.holding = '';
    panel.dataset.closing = '';
    const done = () => {
      panel.removeEventListener('transitionend', ended);
      if (!closing) return;
      clearTimeout(closing);
      closing = 0;
      release();
    };
    const ended = (e) => {
      if (e.target === panel && e.propertyName === 'opacity') done();
    };
    panel.addEventListener('transitionend', ended);
    closing = setTimeout(done, 400);
  }

  function hold() {
    const list = results.querySelector('.pf-results:not(.pf-held)');
    if (!list) return;
    if (!box()?.value.trim()) {
      close();
      return;
    }
    if (closing) {
      clearTimeout(closing);
      closing = 0;
      heldCount?.remove();
      heldCount = null;
      delete panel.dataset.closing;
    }
    const loading =
      list.getAttribute('aria-busy') === 'true' || list.querySelector('.pf-skeleton') !== null;
    if (loading) {
      if (!held && last) {
        held = stand(last, results);
        panel.dataset.holding = '';
      }
      return;
    }
    last = list.cloneNode(true);
    const count = summary.querySelector('.pf-summary:not(.pf-held)');
    if (count?.textContent.trim()) lastCount = count.cloneNode(true);
    if (!held) return;
    if (document.startViewTransition) document.startViewTransition(release);
    else release();
  }

  if (results && panel && summary) {
    const watch = new MutationObserver(hold);
    const opts = {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-busy'],
    };
    watch.observe(results, opts);
    watch.observe(summary, opts);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select'))) {
      return;
    }
    const input = box();
    if (!input) return;
    e.preventDefault();
    input.focus();
  });
})();
// @license-end
