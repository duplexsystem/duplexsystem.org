import { parseHTML } from 'linkedom';
import postcss from 'postcss';
import { calculate } from 'specificity';

const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('');

export function parseRanges(spec) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [lo, hi = lo] = part.trim().replace(/^U\+/i, '').split('-');
    if (!lo) continue;
    for (let c = parseInt(lo, 16); c <= parseInt(hi, 16); c++) out.add(c);
  }
  return out;
}

export function faceRegistry(faces) {
  const reg = new Map();
  for (const f of faces) {
    const list =
      reg.get(f.family.toLowerCase()) ??
      reg.set(f.family.toLowerCase(), []).get(f.family.toLowerCase());
    list.push({ key: f.key, style: f.style, weight: f.weight, cover: parseRanges(f.covers) });
  }
  return reg;
}

export function pickFace(reg, family, style, weight) {
  const all = reg.get(family.toLowerCase());
  if (!all) return null;
  const same = all.filter((f) => f.style === style);
  const pool = same.length ? same : all;
  const w = matchWeight(
    weight,
    pool.map((f) => f.weight),
  );
  return pool.find((f) => f.weight === w);
}

export function matchWeight(w, have) {
  const sorted = [...have].sort((a, b) => a - b);
  if (sorted.includes(w)) return w;
  const below = sorted.filter((x) => x < w).reverse();
  const above = sorted.filter((x) => x > w);
  if (w >= 400 && w <= 500) {
    const upTo500 = above.filter((x) => x <= 500);
    return upTo500[0] ?? below[0] ?? above[0];
  }
  return w < 400 ? (below[0] ?? above[0]) : (above[0] ?? below[0]);
}

const WEIGHTS = { normal: 400, bold: 700 };
const bolder = (p) => (p < 350 ? 400 : p < 550 ? 700 : 900);
const lighter = (p) => (p < 550 ? 100 : p < 750 ? 400 : 700);

const familyName = (name) => {
  const n = name.trim().replace(/^["']|["']$/g, '');
  if (/ fallback: /.test(n)) return 'system';
  return n.replace(/-[0-9a-f]{16}$/, '');
};

export function familyList(value, vars = new Map()) {
  const v = value.trim();
  if (v === 'inherit') return 'inherit';
  const out = [];
  for (const part of v.split(/,(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/)) {
    const variable = /^\s*var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)\s*$/.exec(part);
    if (variable) {
      const inner = vars.get(variable[1]) ?? variable[2];
      if (inner) out.push(...familyList(inner, vars));
    } else if (part.trim()) out.push(familyName(part));
  }
  return out;
}

function fontDecls(decls, vars) {
  const out = {};
  const set = (prop, value, important) => {
    out[prop] = { value, important };
  };
  for (const d of decls) {
    const prop = d.prop.toLowerCase();
    const v = d.value.trim();
    if (prop === 'font-family') set('family', familyList(v, vars), d.important);
    else if (prop === 'font-style')
      set(
        'style',
        /italic|oblique/.test(v) ? 'italic' : v === 'inherit' ? 'inherit' : 'normal',
        d.important,
      );
    else if (prop === 'font-weight') set('weight', v, d.important);
    else if (prop === 'display') set('display', v, d.important);
    else if (prop === 'content') set('content', v, d.important);
    else if (prop === 'font') {
      if (v === 'inherit') {
        for (const p of ['family', 'style', 'weight']) set(p, 'inherit', d.important);
        continue;
      }
      set('family', familyList(v.replace(/^.*?\d[\w.%]*(\/[\w.%]+)?\s+/, ''), vars), d.important);
      set('style', /\b(italic|oblique)\b/.test(v) ? 'italic' : 'normal', d.important);
      const w = /\b(bold|bolder|lighter|[1-9]00)\b/.exec(v);
      set('weight', w ? w[1] : 'normal', d.important);
    }
  }
  return out;
}

export function cssRules(cssTexts, { scripting = true } = {}) {
  const rules = [];
  let order = 0;
  const roots = cssTexts.map((css) => postcss.parse(css));
  const vars = new Map();
  for (const root of roots) {
    root.walkDecls(/^--font-/, (d) => vars.set(d.prop, d.value));
  }
  rules.vars = vars;
  for (const root of roots) {
    root.walkRules((rule) => {
      for (let a = rule.parent; a; a = a.parent) {
        if (a.type !== 'atrule') continue;
        if (/^(font-face|keyframes|page)$/.test(a.name)) return;
        if (a.name === 'media' && /\bprint\b/.test(a.params) && !/\bscreen\b/.test(a.params))
          return;
        if (
          a.name === 'media' &&
          new RegExp(`scripting\\s*:\\s*${scripting ? 'none' : 'enabled'}`).test(a.params)
        )
          return;
      }
      const decls = fontDecls(
        rule.nodes.filter((n) => n.type === 'decl'),
        vars,
      );
      if (!Object.keys(decls).length) return;
      for (const raw of rule.selectors) {
        let selector = raw.trim();
        let pseudo = null;
        const m = /::?(before|after)\s*$/i.exec(selector);
        if (m) {
          pseudo = m[1].toLowerCase();
          selector = selector.slice(0, m.index) || '*';
        }
        if (/::/.test(selector)) continue;
        if (/:(hover|focus|focus-visible|focus-within|active|visited|target)\b/.test(selector))
          continue;
        let spec;
        try {
          const s = calculate(raw)[0] ?? calculate(raw);
          spec = [s.A, s.B, s.C];
        } catch {
          continue;
        }
        rules.push({ selector, pseudo, spec, order: order++, decls });
      }
    });
  }
  return rules;
}

const UA = [
  ['b, strong', { weight: 'bolder' }],
  ['th, h1, h2, h3, h4, h5, h6', { weight: 'bold' }],
  ['em, i, cite, var, dfn, address', { style: 'italic' }],
  ['input, button, textarea, select', { family: ['system'], style: 'normal', weight: 'normal' }],
  ['[hidden], head, script, style, template, title', { display: 'none' }],
];

const beats = (a, b) =>
  !b ||
  (a.important !== b.important
    ? a.important
    : a.spec[0] - b.spec[0] ||
      a.spec[1] - b.spec[1] ||
      a.spec[2] - b.spec[2] ||
      a.order - b.order) > 0;

function cascade(document, rules) {
  const declared = new Map();
  const pseudos = new Map();
  const apply = (el, props, spec, order, important = false, pseudo = null) => {
    const key = pseudo ? `${pseudo}` : '';
    const box = pseudo
      ? (pseudos.get(el) ?? pseudos.set(el, {}).get(el))
      : (declared.get(el) ?? declared.set(el, {}).get(el));
    const target = pseudo ? (box[key] ??= {}) : box;
    for (const [prop, d] of Object.entries(props)) {
      const candidate = { value: d.value ?? d, important: d.important ?? important, spec, order };
      if (beats(candidate, target[prop])) target[prop] = candidate;
    }
  };
  UA.forEach(([sel, props], i) => {
    for (const el of document.querySelectorAll(sel)) apply(el, props, [-1, 0, 0], i);
  });
  for (const r of rules) {
    let els;
    try {
      els = document.querySelectorAll(r.selector);
    } catch {
      continue;
    }
    for (const el of els) apply(el, r.decls, r.spec, r.order, false, r.pseudo);
  }
  for (const el of document.querySelectorAll('[style]')) {
    try {
      const decls = fontDecls(
        postcss.parse(`x{${el.getAttribute('style')}}`).first.nodes,
        rules.vars,
      );
      apply(el, decls, [1, 0, 0, 0], 1e9);
    } catch {
    }
  }
  return { declared, pseudos };
}

const contentText = (value) => {
  const v = value.replace(/\/\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*$/, '');
  return [...v.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)]
    .map((m) =>
      (m[1] ?? m[2])
        .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/\\(.)/g, '$1'),
    )
    .join('');
};

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;

export function pageFontChars(html, rules, faces, probe = () => []) {
  const reg = faces instanceof Map ? faces : faceRegistry(faces);
  const { document } = parseHTML(html);
  const probes = probe(document);
  const { declared, pseudos } = cascade(document, rules);
  const chars = new Map();
  const add = (font, text) => {
    if (!text) return;
    for (const { segment } of segmenter.segment(text.replace(/[\t\n\r\f]/g, ' '))) {
      const base = segment.codePointAt(0);
      for (const fam of font.family) {
        const face = pickFace(reg, fam, font.style, font.weight);
        if (!face || !face.cover.has(base)) continue;
        const set = chars.get(face.key) ?? chars.set(face.key, new Set()).get(face.key);
        for (const ch of segment) if (face.cover.has(ch.codePointAt(0))) set.add(ch);
        break;
      }
      for (const ch of segment) {
        if (!IGNORABLE.test(ch)) continue;
        for (const fam of font.family) {
          const face = pickFace(reg, fam, font.style, font.weight);
          if (!face?.cover.has(ch.codePointAt(0))) continue;
          (chars.get(face.key) ?? chars.set(face.key, new Set()).get(face.key)).add(ch);
          break;
        }
      }
    }
  };
  const resolve = (d, parent) => {
    const get = (p) => (d?.[p] && d[p].value !== 'inherit' ? d[p].value : undefined);
    const w = get('weight');
    const pw = parent.weight;
    return {
      family: get('family') ?? parent.family,
      style: get('style') ?? parent.style,
      weight:
        w === undefined
          ? pw
          : w === 'bolder'
            ? bolder(pw)
            : w === 'lighter'
              ? lighter(pw)
              : (WEIGHTS[w] ?? (Number(w) || pw)),
    };
  };
  const walk = (el, parent) => {
    const d = declared.get(el);
    if (d?.display?.value === 'none') return;
    const own = resolve(d, parent);
    if (probes.includes(el)) add(own, ASCII);
    const ps = pseudos.get(el);
    for (const which of ['before', 'after']) {
      const p = ps?.[which];
      if (p?.content) add(resolve(p, own), contentText(p.content.value));
    }
    if (el.localName === 'input' || el.localName === 'textarea') {
      add(own, (el.getAttribute('value') ?? '') + (el.getAttribute('placeholder') ?? '') + ASCII);
    }
    for (const n of el.childNodes) {
      if (n.nodeType === 3) add(own, n.data);
      else if (n.nodeType === 1) walk(n, own);
    }
  };
  walk(document.documentElement, { family: ['system'], style: 'normal', weight: 400 });
  return { chars };
}

export function probeScripts(document) {
  const added = [];
  const make = (parent, tag, cls) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    el.textContent = 'x';
    parent.appendChild(el);
    added.push(el);
    return el;
  };
  const line = document.querySelector('pre.is-runnable code .line');
  if (line) make(make(line, 'span', 'runval'), 'b');
  for (const el of document.querySelectorAll('.runfoot__text, .runfoot__count, .runbar__arg'))
    added.push(el);
  const pre = document.querySelector('pre');
  if (pre) {
    const wrap = document.createElement('div');
    wrap.className = 'codewrap';
    pre.parentNode.insertBefore(wrap, pre);
    make(wrap, 'button', 'copy');
  }
  for (const el of document.querySelectorAll('#addr, #addr-link, #addr-status')) {
    el.removeAttribute('hidden');
    added.push(el);
  }
  return added;
}
