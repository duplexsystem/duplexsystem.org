// @license magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt AGPL-3.0-or-later
// Adds a copy button to every code block on a post.
//
// Without it, `pre { user-select: all }` means one click selects the block, so
// `has-copy` is set only once a real button exists.
document.documentElement.classList.add('has-copy');
const status = document.createElement('div');
status.className = 'vh';
status.setAttribute('role', 'status');
(document.getElementById('main') ?? document.body).appendChild(status);
for (const pre of document.querySelectorAll('#main pre')) {
  const wrap = document.createElement('div');
  wrap.className = 'codewrap';
  pre.parentNode.insertBefore(wrap, pre);
  wrap.appendChild(pre);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy';
  btn.textContent = 'copy';
  btn.setAttribute('aria-label', 'Copy code to clipboard');

  btn.addEventListener('click', async () => {
    const text = (pre.querySelector('code') || pre).textContent;
    let ok = false;
    try {
      // Secure contexts only; undefined over plain http, as on a LAN.
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      /* fall through to the legacy path below */
    }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      // Off-screen, not display:none: a hidden textarea cannot be selected,
      // and iOS needs it in the viewport.
      ta.style.cssText =
        'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      try {
        ok = document.execCommand('copy');
      } catch {
        /* stays false */
      }
      ta.remove();
    }
    if (!ok) {
      const range = document.createRange();
      range.selectNodeContents(pre.querySelector('code') || pre);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    btn.textContent = ok ? 'copied' : 'selected';
    status.textContent = ok
      ? 'Code copied to clipboard'
      : 'Copying failed, so the code has been selected. Copy it with Ctrl+C';
    setTimeout(() => {
      btn.textContent = 'copy';
      status.textContent = '';
    }, 1600);
  });

  wrap.appendChild(btn);
}
// @license-end
