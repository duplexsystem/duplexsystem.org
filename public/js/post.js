// @license magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt AGPL-3.0-or-later
(() => {
  const content = document.querySelector('.e-content');
  const notes = content?.querySelector('section.footnotes, [data-footnotes]');
  const heads = content
    ? [...content.querySelectorAll('h2[id]')].filter((h) => !notes?.contains(h))
    : [];
  if (heads.length < 3) return;
  const minutes = Number(document.querySelector('[data-minutes]')?.dataset.minutes) || 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const LINE = 0.3;
  const PAD = 24;
  const GAP = 2;
  const RAMP = 32;
  const CELL = 2;
  const BAYER = [
    [4, 0],
    [2, 6],
    [5, 1],
    [3, 7],
  ];
  const HOLD = 1400;

  const name = (h) => h.textContent.trim();
  const sections = [{ el: null, title: 'Start', href: '#' }].concat(
    heads.map((h) => ({ el: h, title: name(h), href: `#${h.id}` })),
    notes ? [{ el: notes, title: 'Footnotes', href: '#footnote-label' }] : [],
  );
  const count = heads.length;

  const el = (tag, cls, parent) => {
    const e = document.createElement(tag);
    e.className = cls;
    parent?.appendChild(e);
    return e;
  };
  const nav = el('nav', 'progress');
  nav.setAttribute('aria-label', 'Reading progress');
  const rail = el('div', 'progress__rail', nav);
  rail.setAttribute('aria-hidden', 'true');
  const canvas = el('canvas', 'progress__canvas', rail);
  const ctx = canvas.getContext('2d');
  const segs = sections.map(() => ({ top: 0, h: 0 }));
  const labels = el('div', 'progress__labels', nav);
  const prev = el('a', 'progress__prev', labels);
  const here = el('div', 'progress__here', labels);
  const pos = el('span', 'progress__pos', here);
  const title = el('span', 'progress__title', here);
  const next = el('a', 'progress__next', labels);
  document.body.appendChild(nav);

  let start = 0;
  let end = 1;
  let railLen = 0;
  let flat = false;
  let bounds = [];
  let current = -1;
  let holdTimer = 0;

  const foot = document.querySelector('.foot');
  let dpr = 1;
  let unit = 1;
  let acc = '#b48cff';
  const pageY = (e) => e.getBoundingClientRect().top + scrollY;
  const even = (n) => Math.round(n / 2) * 2;

  function measure() {
    const box = content.getBoundingClientRect();
    start = box.top + scrollY;
    end = box.bottom + scrollY;
    bounds = [start, ...sections.slice(1).map((sec) => pageY(sec.el)), end];
    const winOut = parseFloat(getComputedStyle(document.querySelector('.post')).getPropertyValue('--win-out')) || 17;
    dpr = devicePixelRatio || 1;
    unit = [1, 2, 3, 4, 5, 6, 7, 8].find((m) => Math.abs(m * dpr - Math.round(m * dpr)) < 1e-6) ?? 1;
    acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || acc;
    const x = Math.floor((box.left - winOut - 10) / unit) * unit;
    nav.style.setProperty('--progress-x', `${x}px`);
    nav.style.setProperty('--progress-label-w', `${Math.min(220, x - 20)}px`);
    flat = x < 8;
    nav.classList.toggle('progress--flat', flat);
    nav.classList.toggle('progress--bare', !flat && x - 20 < 96);
    railLen = flat ? document.documentElement.clientWidth : innerHeight - 2 * PAD;
    const span = end - start;
    segs.forEach((s, i) => {
      const a = even(((bounds[i] - start) / span) * railLen);
      const b = even(((bounds[i + 1] - start) / span) * railLen);
      s.top = a;
      s.h = Math.max(2, b - a - GAP);
    });
    canvas.width = dev(flat ? railLen : 4);
    canvas.height = dev(flat ? 4 : railLen);
    canvas.style.width = `${flat ? railLen : 4}px`;
    canvas.style.height = `${flat ? 4 : railLen}px`;
    drawn = -1;
    update(true);
  }

  function setLabel(a, i) {
    const s = sections[i];
    a.hidden = !s;
    if (!s) return;
    a.textContent = s.title;
    a.href = s.href;
  }

  function where(i, f) {
    const left = Math.max(0, Math.ceil(minutes * (1 - f)));
    const at = i === 0 ? 'START' : i > count ? 'NOTES' : `§${i}/${count}`;
    return f >= 1 ? `${at} · END` : `${at} · ${left} MIN LEFT`;
  }

  function enter(i, quiet) {
    const forward = i > current;
    current = i;
    setLabel(prev, i - 1);
    setLabel(next, i + 1);
    clearTimeout(holdTimer);
    if (quiet || i === 0) {
      here.classList.remove('is-title', 'is-up', 'is-down');
      title.textContent = '';
      return;
    }
    title.textContent = sections[i].title;
    here.classList.remove('is-up', 'is-down', 'is-title');
    if (!reduced.matches) {
      void here.offsetWidth;
      here.classList.add(forward ? 'is-up' : 'is-down');
    }
    here.classList.add('is-title');
    for (const a of [prev, next]) {
      a.classList.remove('is-new');
      void a.offsetWidth;
      a.classList.add('is-new');
    }
    holdTimer = setTimeout(() => {
      here.classList.remove('is-title');
      holdTimer = setTimeout(() => {
        title.textContent = '';
        update();
      }, 240);
    }, HOLD);
  }

  const dev = (v) => Math.round(v * dpr);
  const box = (fn, along, across, len, wide) => {
    const [x, y, w, h] = flat ? [along, across, len, wide] : [across, along, wide, len];
    fn.call(ctx, dev(x), dev(y), dev(x + w) - dev(x), dev(y + h) - dev(y));
  };
  const rect = (along, across, len, wide) => box(ctx.fillRect, along, across, len, wide);
  const clear = (along, len) => box(ctx.clearRect, along, 0, len, 4);

  function draw(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = acc;
    ctx.globalAlpha = 0.45;
    for (const s of segs) {
      rect(s.top, 0, 1, 4);
      rect(s.top + s.h - 1, 0, 1, 4);
      rect(s.top + 1, 0, s.h - 2, 1);
      rect(s.top + 1, 3, s.h - 2, 1);
    }
    const solid = Math.max(0, Math.min(railLen, Math.floor((t - RAMP) / CELL) * CELL));
    ctx.globalAlpha = 1;
    clear(0, solid);
    rect(0, 0, solid, 4);
    for (let y = solid; y < Math.min(Math.ceil(t / CELL) * CELL, railLen); y += CELL) {
      const density = (t - (y + CELL / 2)) / RAMP;
      const row = BAYER[(y / CELL) % 4];
      for (let c = 0; c < 2; c++) {
        const a = Math.min(1, Math.max(0, (density - row[c] / 8) * 8));
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        rect(y, c * CELL, CELL, CELL);
      }
    }
    ctx.globalAlpha = 1;
    for (const s of segs.slice(1)) clear(s.top - GAP, GAP);
  }

  let queued = false;
  let front = -1;
  let target = 0;
  let drawn = -1;
  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => update());
    }
  };
  function update(quiet = false) {
    queued = false;
    const line = scrollY + innerHeight * LINE;
    const atBottom = scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
    const f = atBottom && end <= scrollY + innerHeight ? 1 : Math.min(1, Math.max(0, (line - start) / (end - start)));
    target = f * (railLen + RAMP);
    if (quiet || reduced.matches || front < 0) front = target;
    else front += (target - front) * 0.2;
    if (Math.abs(target - front) < 0.05) front = target;
    else queue();
    const t = front;
    const tip = Math.min(railLen, Math.max(0, t - RAMP / 2));
    let i = 0;
    while (i + 1 < sections.length && bounds[i + 1] <= line) i++;
    nav.classList.toggle('is-on', line > start + innerHeight * 0.15);
    if (t !== drawn) {
      drawn = t;
      draw(t);
    }
    const footTop = foot && !flat ? foot.getBoundingClientRect().top : Infinity;
    const lift = Math.min(0, Math.floor((footTop - 16 - (PAD + railLen)) / unit) * unit);
    nav.style.transform = lift ? `translateY(${lift}px)` : '';
    if (i !== current) enter(i, quiet || current === -1);
    pos.textContent = where(i, f);
    if (flat) return;
    const lh = labels.offsetHeight;
    const hh = here.offsetHeight;
    const above = prev.hidden ? 0 : prev.offsetHeight + 6;
    const y = Math.round(Math.min(Math.max(PAD + tip - above - hh / 2, PAD), PAD + railLen - lh));
    labels.style.transform = `translateY(${y}px)`;
  }
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', measure);
  new ResizeObserver(measure).observe(content);
  document.fonts?.ready.then(measure);
  measure();
})();

(() => {
  const plain = (e) => e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
  let returning = null;
  let following = null;

  addEventListener('click', (e) => {
    const a = e.target.closest?.('a[data-footnote-ref], a[data-footnote-backref]');
    if (!a || e.defaultPrevented || !plain(e)) return;
    if (a.hasAttribute('data-footnote-ref')) {
      following = { from: a.id, y: scrollY, hash: a.hash };
      return;
    }
    const ref = decodeURIComponent(a.hash.slice(1));
    if (history.state?.footnoteFrom !== ref) return;
    e.preventDefault();
    returning = { ref, y: history.state.footnoteY };
    history.back();
  });

  addEventListener('hashchange', () => {
    if (!following) return;
    const { from, y, hash } = following;
    following = null;
    if (location.hash !== hash) return;
    history.replaceState({ ...history.state, footnoteFrom: from, footnoteY: y }, '');
  });

  addEventListener('popstate', () => {
    if (!returning) return;
    const { y } = returning;
    const ref = document.getElementById(returning.ref);
    returning = null;
    if (typeof y === 'number' && Math.abs(scrollY - y) > 1) scrollTo(0, y);
    if (!ref) return;
    ref.classList.remove('is-returned');
    void ref.offsetWidth;
    ref.classList.add('is-returned');
    ref.focus({ preventScroll: true });
  });
})();
// @license-end
