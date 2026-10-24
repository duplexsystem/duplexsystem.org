import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT, htmlPages } from './gates.mjs';
import { cssRules, faceRegistry, pageFontChars, probeScripts } from './font-usage.mjs';

const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i));

const SEARCH_FACES = ['literata-roman-400', 'literata-roman-600', 'departure-mono'];

export async function siteFontChars(distDir, { extraCss = [] } = {}) {
  const manifest = JSON.parse(
    await readFile(join(REPO_ROOT, 'src/assets/fonts/generated/fonts.json'), 'utf8'),
  );
  const reg = faceRegistry(manifest.faces);
  const cover = new Map([...reg.values()].flat().map((f) => [f.key, f.cover]));
  const cssDir = join(distDir, '_astro');
  const css = [
    ...(await Promise.all(
      (await readdir(cssDir))
        .filter((f) => f.endsWith('.css'))
        .map((f) => readFile(join(cssDir, f), 'utf8')),
    )),
    ...extraCss,
  ];
  const faces = new Map();
  const perPage = [];
  const add = (face, chars) => {
    const s = faces.get(face) ?? faces.set(face, new Set()).get(face);
    for (const ch of chars) if (cover.get(face)?.has(ch.codePointAt(0))) s.add(ch);
  };
  for await (const { path, html } of htmlPages(distDir)) {
    const styles = (withNoscript) =>
      [
        ...(withNoscript ? html : html.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')).matchAll(
          /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
        ),
      ].map((m) => m[1]);
    const on = pageFontChars(html, cssRules([...css, ...styles(false)]), reg, probeScripts);
    const off = pageFontChars(html, cssRules([...css, ...styles(true)], { scripting: false }), reg);
    const chars = new Map(on.chars);
    for (const [face, set] of off.chars)
      chars.set(face, new Set([...(chars.get(face) ?? []), ...set]));
    perPage.push({ path, chars });
    for (const [face, set] of chars) add(face, set);
  }
  const literata = new Set(
    [...faces].filter(([f]) => f.startsWith('literata-')).flatMap(([, s]) => [...s]),
  );
  for (const face of SEARCH_FACES) add(face, [...literata, ...ASCII]);
  return { faces, perPage };
}
