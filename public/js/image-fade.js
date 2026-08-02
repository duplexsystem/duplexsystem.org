// @license magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt AGPL-3.0-or-later
// Fades in images that made the reader wait, and only those. Fade length
// follows how long the placeholder was on screen, not how long the image
// took to load. Without JS every image is simply visible over its gradient.
(() => {
  'use strict';

  const SELECTOR = '.hero-wrap .post__hero, .ph > img';

  const navType = performance.getEntriesByType?.('navigation')[0]?.type;
  const isRevisit = navType === 'reload' || navType === 'back_forward';

  const SEEN_KEY = 'img-fade-seen';
  let seen;
  try {
    seen = new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]'));
  } catch {
    seen = new Set();
  }
  function remember(img) {
    const src = img.currentSrc || img.src;
    if (!src || seen.has(src)) return;
    seen.add(src);
    try {
      sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
    } catch {}
  }

  const INSTANT_MS = 60;
  // Higher bar on a revisit: its short waits are cache reads, not waiting.
  const SEEN_INSTANT_MS = 250;
  const MIN_FADE_MS = 100;
  const MAX_FADE_MS = 400;

  const visibleSince = new Map();
  const pending = new Set();
  let initAt = 0;

  const observer =
    'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !visibleSince.has(entry.target)) {
              visibleSince.set(entry.target, performance.now());
              observer.unobserve(entry.target);
            }
          }
        })
      : null;

  function fadeMs(waited, threshold) {
    if (waited <= threshold) return 0;
    return Math.min(MIN_FADE_MS + (waited - threshold) / 2, MAX_FADE_MS);
  }

  function onScreen(img) {
    const r = img.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  function visibleWait(img) {
    if (!observer) return performance.now() - initAt;
    const since = visibleSince.get(img);
    if (since !== undefined) return performance.now() - since;
    // IntersectionObserver callbacks batch at frame boundaries, so a load can
    // beat its own stamp. Live geometry beats trusting the history.
    if (onScreen(img)) return INSTANT_MS + 1;
    return 0;
  }

  function forget(img) {
    pending.delete(img);
    visibleSince.delete(img);
    observer?.unobserve(img);
  }

  function revealInstantly(img) {
    forget(img);
    img.style.setProperty('--fade', '0ms');
    img.classList.add('is-revealed');
  }

  async function reveal(img) {
    const alreadySeen = isRevisit || seen.has(img.currentSrc || img.src);
    remember(img);
    const duration = fadeMs(visibleWait(img), alreadySeen ? SEEN_INSTANT_MS : INSTANT_MS);
    if (duration === 0) {
      revealInstantly(img);
      return;
    }
    forget(img);

    try {
      await img.decode();
    } catch {}

    // Raster warm-up: decode() makes pixels, not a composited texture, and the
    // renderer only rasterizes on the first painted frame. opacity 0.01 forces
    // that paint now; the double rAF waits for it to commit.
    img.style.opacity = '0.01';
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));

    img.style.setProperty('--fade', `${Math.round(duration)}ms`);
    requestAnimationFrame(() => {
      img.style.opacity = '';
      img.classList.add('is-revealed');
    });
  }

  function init() {
    initAt = performance.now();
    for (const img of document.querySelectorAll(SELECTOR)) {
      // Already loaded: hiding it now is what causes the cached-reload flash.
      // Remembered so a later revisit knows it was not first sight.
      if (img.complete) {
        remember(img);
        continue;
      }

      img.classList.add('is-pending');
      pending.add(img);
      observer?.observe(img);

      img.addEventListener('load', () => reveal(img), { once: true });
      img.addEventListener('error', () => revealInstantly(img), { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // On a bfcache restore an image pending at navigation has since fired its
  // load event, so its listener is gone and it would stay invisible.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    for (const img of [...pending]) revealInstantly(img);
  });
})();
// @license-end
