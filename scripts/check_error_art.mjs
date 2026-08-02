#!/usr/bin/env node
// Contract for the err-*.svg error-portal artworks: pixel art on a 24-grid,
// steps(1,end) frame swaps, no class or keyframe names shared between files,
// loops that wrap without visible motion, and a prefers-reduced-motion block.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ART_DIR = 'src/assets/errors';

function parseKeyframes(css) {
  const out = [];
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(start, i - 1);
    const stops = [];
    for (const s of body.matchAll(/([\d.%,\sfromto]+)\{([^}]*)\}/g)) {
      const props = {};
      for (const p of s[2].matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) {
        props[p[1].trim()] = p[2].trim();
      }
      for (const sel of s[1].split(',')) {
        const label = sel.trim();
        if (!label) continue;
        const at = label === 'from' ? 0 : label === 'to' ? 100 : parseFloat(label);
        if (!Number.isFinite(at)) continue;
        stops.push({ at, props });
      }
    }
    stops.sort((a, b) => a.at - b.at);
    out.push({ name: m[1], stops });
  }
  return out;
}

function finalDisplayed(stops, prop) {
  let value;
  let sawEver = false;
  for (const s of stops) {
    if (s.props[prop] === undefined) continue;
    sawEver = true;
    if (s.at < 100) value = s.props[prop];
  }
  if (!sawEver) return { value: undefined, animated: false };
  return { value, animated: true };
}

function initial(stops, prop) {
  const zero = stops.find((s) => s.at === 0);
  return zero?.props[prop];
}

const norm = (v) => (v ?? '').replace(/\s+/g, '');
const isRestTransform = (v) => {
  const n = norm(v);
  return n === '' || n === 'none' || /^translate[XY]?\((0(px)?,?)+\)$/.test(n);
};

export async function checkErrorArt(dir = ART_DIR) {
  const failures = [];
  const classOwners = new Map(); // class/keyframe name -> file, for collisions

  const files = (await readdir(dir)).filter((f) => /^err-\d{3}\.svg$/.test(f)).sort();
  if (files.length === 0) failures.push(`${dir}: no err-*.svg artworks found`);

  for (const file of files) {
    const svg = await readFile(join(dir, file), 'utf8');
    const fail = (msg) => failures.push(`${file}: ${msg}`);

    if (!/viewBox="0 0 24 24"/.test(svg)) fail('viewBox is not "0 0 24 24"');
    if (/<script/i.test(svg)) fail('contains a <script>');
    if (/<text/i.test(svg)) fail('contains <text>: glyphs must be drawn from rects');
    if (!/role="img"/.test(svg)) fail('missing role="img"');
    if (!/aria-label="[^"]+"/.test(svg)) fail('missing aria-label');

    const disallowed = [...svg.matchAll(/<(?!\/)([a-zA-Z-]+)/g)]
      .map((m) => m[1])
      .filter((t) => !['svg', 'style', 'defs', 'clipPath', 'g', 'rect'].includes(t));
    if (disallowed.length) fail(`disallowed element(s): ${[...new Set(disallowed)].join(', ')}`);

    for (const r of svg.matchAll(/<rect\b[^>]*>/g)) {
      for (const attr of ['x', 'y', 'width', 'height']) {
        const v = r[0].match(new RegExp(`${attr}="([^"]*)"`))?.[1];
        const intOk = attr === 'x' || attr === 'y' ? /^-?\d+$/ : /^\d+$/;
        if (v !== undefined && !intOk.test(v)) {
          fail(`non-integer rect ${attr}="${v}"`);
          break;
        }
      }
    }

    const css = [...svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

    for (const rule of css.matchAll(/(^|\})\s*([^@{}]+)\{/g)) {
      for (const sel of rule[2].split(',')) {
        const s = sel.trim();
        if (/^(rect|g|svg|path)$/.test(s)) fail(`bare element selector "${s}": SVGO breaks these`);
      }
    }

    for (const anim of css.matchAll(/animation:\s*([^;}]+)[;}]/g)) {
      const value = anim[1].trim();
      if (value === 'none') continue;
      if (!/steps\(\s*1\s*,\s*end\s*\)/.test(value)) {
        fail(`animation without steps(1, end): "${value}"`);
      }
    }

    const keyframes = parseKeyframes(css);
    if (keyframes.length > 0 && !/prefers-reduced-motion/.test(css)) {
      fail('animated but missing a prefers-reduced-motion block');
    }

    const names = new Set();
    for (const c of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) names.add('.' + c[1]);
    for (const k of keyframes) names.add('@' + k.name);
    for (const n of names) {
      if (classOwners.has(n) && classOwners.get(n) !== file) {
        fail(`name ${n} collides with ${classOwners.get(n)}`);
      } else {
        classOwners.set(n, file);
      }
    }

    const animBindings = [...css.matchAll(/\.([\w-]+)[^{]*\{[^}]*animation:\s*([\w-]+)/g)];
    const kfByName = new Map(keyframes.map((k) => [k.name, k]));
    for (const [, cls, kfName] of animBindings) {
      const kf = kfByName.get(kfName);
      if (!kf || kf.stops.length === 0) continue;

      const t = finalDisplayed(kf.stops, 'transform');
      const o = finalDisplayed(kf.stops, 'opacity');
      if (t.animated) {
        const t0 = initial(kf.stops, 'transform');
        const returns =
          norm(t.value) === norm(t0) || (isRestTransform(t.value) && isRestTransform(t0));
        const hiddenAtWrap = o.animated && parseFloat(o.value) === 0;
        const seamlessPixels = (() => {
          const open = svg.match(new RegExp(`<g class="[^"]*\\b${cls}\\b[^"]*">`));
          if (!open) return false;
          let depth = 1;
          let i = open.index + open[0].length;
          const TAG = /<g\b|<\/g>/g;
          TAG.lastIndex = i;
          let m2;
          let end = -1;
          while ((m2 = TAG.exec(svg))) {
            depth += m2[0] === '</g>' ? -1 : 1;
            if (depth === 0) {
              end = m2.index;
              break;
            }
          }
          if (end < 0) return false;
          const body = svg.slice(i, end);
          const rects = [...body.matchAll(/<rect\b[^>]*>/g)].map((r) => {
            const a = (n) => Number(r[0].match(new RegExp(`${n}="(-?\\d+)"`))?.[1] ?? 0);
            return { x: a('x'), y: a('y'), w: a('width') || 1, h: a('height') || 1 };
          });
          if (rects.length === 0) return false;
          const shift = (tv) => {
            const n = norm(tv ?? '');
            const tx = parseFloat(
              n.match(/translateX\((-?[\d.]+)/)?.[1] ??
                n.match(/translate\((-?[\d.]+)/)?.[1] ??
                '0',
            );
            const pair = n.match(/translate\((-?[\d.]+)(?:px)?,(-?[\d.]+)/);
            const ty = parseFloat(n.match(/translateY\((-?[\d.]+)/)?.[1] ?? pair?.[2] ?? '0');
            return [tx, ty];
          };
          const cells = ([dx, dy]) => {
            const s = new Set();
            for (const r of rects) {
              for (let px = r.x + dx; px < r.x + dx + r.w; px++) {
                for (let py = r.y + dy; py < r.y + dy + r.h; py++) {
                  if (px >= 0 && px < 24 && py >= 0 && py < 24) s.add(px + ',' + py);
                }
              }
            }
            return s;
          };
          const animatedClasses = new Set(animBindings.map(([, c]) => c));
          const backdrop = new Set();
          for (const gm of svg.matchAll(/<g class="([^"]*)">/g)) {
            if ([...animatedClasses].some((c) => gm[1].includes(c))) continue;
            let d2 = 1;
            let j = gm.index + gm[0].length;
            const T2 = /<g\b|<\/g>/g;
            T2.lastIndex = j;
            let n2;
            let e2 = -1;
            while ((n2 = T2.exec(svg))) {
              d2 += n2[0] === '</g>' ? -1 : 1;
              if (d2 === 0) {
                e2 = n2.index;
                break;
              }
            }
            if (e2 < 0) continue;
            for (const r2 of svg.slice(j, e2).matchAll(/<rect\b[^>]*>/g)) {
              const a2 = (n) => Number(r2[0].match(new RegExp(`${n}="(-?\\d+)"`))?.[1] ?? 0);
              const rr = { x: a2('x'), y: a2('y'), w: a2('width') || 1, h: a2('height') || 1 };
              for (let px = rr.x; px < rr.x + rr.w; px++) {
                for (let py = rr.y; py < rr.y + rr.h; py++) {
                  if (px >= 0 && px < 24 && py >= 0 && py < 24) backdrop.add(px + ',' + py);
                }
              }
            }
          }
          const withBackdrop = (s) => new Set([...s, ...backdrop]);
          const a = withBackdrop(cells(shift(t0)));
          const b = withBackdrop(cells(shift(t.value)));
          return a.size === b.size && [...a].every((c) => b.has(c));
        })();
        if (!returns && !hiddenAtWrap && !seamlessPixels) {
          fail(
            `.${cls}/@${kfName}: transform wraps mid-motion: final displayed ` +
              `"${t.value}" vs 0% "${t0 ?? '(unset)'}" changes visible pixels at the loop. ` +
              'Return it, hide it, or make the shift line up with the pattern period.',
          );
        }
        if (o.animated) {
          for (const s of kf.stops) {
            if (s.props.transform === undefined || s.props.opacity === undefined) {
              fail(
                `.${cls}/@${kfName}: stop at ${s.at}% omits ` +
                  `${s.props.transform === undefined ? 'transform' : 'opacity'}: ` +
                  'both must be restated at every stop or the step interpolates',
              );
              break;
            }
          }
        }
      }
    }
  }

  if (failures.length) {
    console.error('FAIL: error-portal artwork contract violations');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`ok: ${files.length} error artwork(s) satisfy the pixel-art contract`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await checkErrorArt(process.argv[2]);
}
