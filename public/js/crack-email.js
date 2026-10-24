// @license magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt AGPL-3.0-or-later
(() => {
  'use strict';

  const out = document.getElementById('addr');
  if (!out || !out.dataset.cipher) return;

  const bytes = out.dataset.cipher.match(/../g).map((h) => parseInt(h, 16));
  const keylen = Number(out.dataset.keylen) || 3;
  const expected = out.dataset.check;

  const ok = (c) =>
    (c >= 97 && c <= 122) ||
    (c >= 48 && c <= 57) ||
    c === 64 ||
    c === 46 ||
    c === 95 ||
    c === 43 ||
    c === 45;

  function fnv1a(codes) {
    let h = 0x811c9dc5;
    for (const c of codes) h = Math.imul(h ^ c, 0x01000193) >>> 0;
    return h.toString(16).padStart(8, '0');
  }

  const decode = (key) => bytes.map((b, i) => b ^ key[i % keylen]);
  const text = (codes) => String.fromCharCode(...codes);

  const columnCandidates = (p) => {
    const hits = [];
    for (let k = 0; k < 256; k++) {
      let good = true;
      for (let i = p; i < bytes.length && good; i += keylen) good = ok(bytes[i] ^ k);
      if (good) hits.push(k);
    }
    return hits;
  };

  function solve(candidates) {
    const walk = (p, key) => {
      if (p === keylen) {
        const codes = decode(key);
        return fnv1a(codes) === expected ? { key, address: text(codes) } : null;
      }
      for (const k of candidates[p]) {
        const found = walk(p + 1, [...key, k]);
        if (found) return found;
      }
      return null;
    };
    return walk(0, []);
  }

  const status = document.getElementById('addr-status');
  const link = document.getElementById('addr-link');

  function progressKey(solved, trial) {
    return trial === null ? solved.join(',') : [...solved, trial].join(',');
  }

  function reveal(address, key) {
    out.textContent = address;
    out.classList.add('is-cracked');
    if (status) {
      status.setAttribute('aria-live', 'polite');
      status.textContent = `cracked · key ${key.join(',')}`;
      status.classList.add('is-done');
    }
    if (link) {
      link.href = `mailto:${address}`;
      link.hidden = false;
      requestAnimationFrame(() => link.classList.add('is-in'));
    }
  }

  const candidates = [];
  for (let p = 0; p < keylen; p++) candidates.push(columnCandidates(p));
  const solution = solve(candidates);
  if (!solution) return;

  const start = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reveal(solution.address, solution.key);
      return;
    }
    status?.setAttribute('aria-live', 'off');
    requestAnimationFrame(frame);
  };

  const FILLER = '#$%&*+=?~^<>/|@';
  const SCRAMBLE_MS = 130;
  const MS_PER_COLUMN = 1600;
  let started = null;

  const filler = (step, i) => FILLER[(step * 7 + i * 13) % FILLER.length];

  function frame(now) {
    if (started === null) started = now;
    const elapsed = now - started;
    const column = Math.floor(elapsed / MS_PER_COLUMN);
    if (column >= keylen) {
      reveal(solution.address, solution.key);
      return;
    }
    const progress = (elapsed % MS_PER_COLUMN) / MS_PER_COLUMN;
    const trial = Math.min(255, Math.floor((1 - (1 - progress) ** 2) * 256));
    const step = Math.floor(elapsed / SCRAMBLE_MS);

    if (status) {
      status.textContent = `cracking · key ${progressKey(solution.key.slice(0, column), trial)}`;
    }

    out.textContent = bytes
      .map((b, i) => {
        const slot = i % keylen;
        if (slot < column) return String.fromCharCode(b ^ solution.key[slot]);
        if (slot > column) return filler(step, i);
        const c = b ^ trial;
        return ok(c) ? String.fromCharCode(c) : filler(step, i);
      })
      .join('');
    requestAnimationFrame(frame);
  }

  if (document.prerendering) {
    document.addEventListener('prerenderingchange', start, { once: true });
  } else {
    start();
  }
})();
// @license-end
