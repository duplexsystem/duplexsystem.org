#!/usr/bin/env node
// KaTeX ships 20 woff2 faces, ~296 kB. Which face draws a glyph is decided by
// CSS class, so the rendered spans give an exact per-face character set and
// fontTools cuts each face down to it. Output goes to _astro/, which nginx
// serves immutable and with CORS.
import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { walk } from './lib/fswalk.mjs';

const KATEX = 'node_modules/katex/dist';
const BASE_FACE = 'KaTeX_Main|normal|400';

const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);
const faceKey = (family, style, weight) => `${family}|${style}|${weight}`;

// Every class of the selector's last compound has to be present: `size3`
// alone is a sizing class and changes no font.
export function classFaces(css) {
  const rules = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selector.includes('@font-face')) continue;
    const family = /font-family:\s*"?(KaTeX_[A-Za-z0-9]+)"?/.exec(body)?.[1];
    if (!family) continue;
    const style = /font-style:\s*italic/.test(body) ? 'italic' : 'normal';
    const weight = /font-weight:\s*(bold|700)/.test(body) ? '700' : '400';
    for (const one of selector.split(',')) {
      const compound =
        one
          .trim()
          .split(/[\s>+~]+/)
          .at(-1) ?? '';
      const classes = [...compound.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
      if (classes.length && !classes.includes('katex')) {
        rules.push({ classes, face: faceKey(family, style, weight) });
      }
    }
  }
  return rules;
}

const faceFor = (rules, classes) => {
  const on = new Set(classes);
  let face;
  for (const rule of rules) if (rule.classes.every((c) => on.has(c))) face = rule.face;
  return face;
};

export function glyphsByFace(html, faces) {
  const used = new Map();
  const add = (face, text) => {
    if (!used.has(face)) used.set(face, new Set());
    const set = used.get(face);
    for (const ch of text) {
      if (ch.codePointAt(0) > 0x20 && !/[\u00AD\u200B-\u200F\u2028\u2029\u2060\uFEFF]/.test(ch)) {
        set.add(ch);
      }
    }
  };

  for (const region of html.matchAll(/<span class="katex-html"[^>]*>/g)) {
    const stack = [BASE_FACE];
    let skip = 0;
    let depth = 1;
    const token = /<(\/?)(\w+)((?:"[^"]*"|[^>])*)>|([^<]+)/g;
    token.lastIndex = region.index + region[0].length;

    for (let m; (m = token.exec(html));) {
      const [, closing, , attrs, text] = m;
      if (text !== undefined) {
        if (!skip) add(stack.at(-1), text.replace(/&nbsp;|&#\d+;|&\w+;/g, ''));
        continue;
      }
      if (closing) {
        depth -= 1;
        if (depth === 0) break;
        if (skip) skip -= 1;
        else stack.pop();
        continue;
      }
      if (attrs.endsWith('/')) continue;
      depth += 1;
      const classes = /class="([^"]*)"/.exec(attrs)?.[1].split(/\s+/) ?? [];
      if (classes.includes('katex-mathml')) {
        skip += 1;
        continue;
      }
      const face = faceFor(faces, classes);
      if (skip) skip += 1;
      else stack.push(face ?? stack.at(-1));
    }
  }
  return used;
}

export function faceFiles(css) {
  const files = new Map();
  for (const [, body] of css.matchAll(/@font-face\{([^}]*)\}/g)) {
    const family = /font-family:\s*"?(KaTeX_[A-Za-z0-9]+)"?/.exec(body)?.[1];
    const file = /url\(fonts\/([^)]+\.woff2)\)/.exec(body)?.[1];
    if (!family || !file) continue;
    const style = /font-style:\s*italic/.test(body) ? 'italic' : 'normal';
    const weight = /font-weight:\s*(bold|700)/.test(body) ? '700' : '400';
    files.set(faceKey(family, style, weight), file);
  }
  return files;
}

async function main(distDir = 'dist') {
  const pages = [];
  for await (const path of walk(distDir)) {
    if (path.endsWith('.html')) pages.push(path);
  }

  const css = await readFile(join(KATEX, 'katex.min.css'), 'utf8');
  const faces = classFaces(css);
  const files = faceFiles(css);

  const mathPages = [];
  const wanted = new Map();
  for (const path of pages) {
    const html = await readFile(path, 'utf8');
    if (!html.includes('class="katex')) continue;
    mathPages.push(path);
    for (const [face, chars] of glyphsByFace(html, faces)) {
      if (!wanted.has(face)) wanted.set(face, new Set());
      for (const ch of chars) wanted.get(face).add(ch);
    }
  }

  if (mathPages.length === 0) {
    console.log('katex: no math in this build, nothing shipped');
    return { pages: 0, faces: 0 };
  }

  const missing = [...wanted.keys()].filter((face) => !files.has(face));
  if (missing.length) {
    console.error(`FAIL: katex has no font face for ${missing.join(', ')}`);
    process.exit(1);
  }

  const work = join(tmpdir(), `katex-${process.pid}`);
  await mkdir(work, { recursive: true });
  const subsets = new Map();
  let original = 0;
  for (const [face, chars] of wanted) {
    const src = join(KATEX, 'fonts', files.get(face));
    const out = join(work, files.get(face));
    const codes = [...chars].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase()}`);
    const run = spawnSync(
      'python3',
      [
        '-c',
        'import sys;from fontTools import subset;subset.main(sys.argv[1:])',
        src,
        `--output-file=${out}`,
        '--flavor=woff2',
        '--no-hinting',
        '--desubroutinize',
        `--unicodes=${codes.join(',')}`,
      ],
      { encoding: 'utf8' },
    );
    if (run.status !== 0) {
      console.error(`FAIL: subsetting ${files.get(face)}\n${run.stderr}`);
      process.exit(1);
    }
    const kept = new Set(
      JSON.parse(
        spawnSync(
          'python3',
          [
            '-c',
            'import sys,json;from fontTools.ttLib import TTFont;' +
              'print(json.dumps(sorted(TTFont(sys.argv[1]).getBestCmap())))',
            out,
          ],
          { encoding: 'utf8' },
        ).stdout,
      ),
    );
    const lost = [...chars].filter((c) => !kept.has(c.codePointAt(0)));
    if (lost.length) {
      console.error(`FAIL: ${files.get(face)} cannot draw ${lost.join(' ')}`);
      process.exit(1);
    }
    original += (await readFile(src)).length;
    subsets.set(face, { bytes: await readFile(out), glyphs: chars.size });
  }

  await mkdir(join(distDir, '_astro'), { recursive: true });
  const names = new Map();
  let shipped = 0;
  for (const [face, { bytes }] of subsets) {
    const name = files.get(face).replace('.woff2', `.${hash8(bytes)}.woff2`);
    await writeFile(join(distDir, '_astro', name), bytes);
    names.set(face, name);
    shipped += bytes.length;
  }

  const trimmed = css.replace(/@font-face\{([^}]*)\}/g, (block, body) => {
    const family = /font-family:\s*"?(KaTeX_[A-Za-z0-9]+)"?/.exec(body)?.[1];
    const style = /font-style:\s*italic/.test(body) ? 'italic' : 'normal';
    const weight = /font-weight:\s*(bold|700)/.test(body) ? '700' : '400';
    const name = names.get(faceKey(family, style, weight));
    if (!name) return '';
    return `@font-face{${body.replace(/src:[^;]+/, `src:url(/_astro/${name}) format("woff2")`)}}`;
  });

  const cssName = `katex.${hash8(Buffer.from(trimmed))}.css`;
  await writeFile(join(distDir, '_astro', cssName), trimmed);
  for (const path of mathPages) {
    const html = await readFile(path, 'utf8');
    await writeFile(
      path,
      html.replace('</head>', `<link rel="stylesheet" href="/_astro/${cssName}" />\n</head>`),
    );
  }
  await rm(work, { recursive: true, force: true });

  const glyphs = [...subsets.values()].reduce((n, s) => n + s.glyphs, 0);
  console.log(
    `katex: ${subsets.size} face(s) subset to ${glyphs} glyph(s), ` +
      `${(original / 1024).toFixed(1)} kB -> ${(shipped / 1024).toFixed(1)} kB, ` +
      `linked on ${mathPages.length} page(s)`,
  );
  return { pages: mathPages.length, faces: subsets.size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv[2]);
}
