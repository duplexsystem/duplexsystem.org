#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { GateError, runMain } from './lib/gates.mjs';

const BUNDLE_NAME = /^pagefind-component-ui(\.[0-9a-f]{8})?\.js$/;
const pagePath = (dist) => `${dist}/search/index.html`;

async function main(distDir = 'dist') {
  const PAGE = pagePath(distDir);
  const name = (await readdir(`${distDir}/pagefind`).catch(() => [])).find((f) =>
    BUNDLE_NAME.test(f),
  );
  if (!name) {
    throw new GateError(`${distDir}/pagefind/pagefind-component-ui*.js missing. Did pagefind run?`);
  }
  const BUNDLE = `${distDir}/pagefind/${name}`;

  globalThis.window = globalThis;
  globalThis.HTMLElement = class HTMLElement {};
  globalThis.customElements = { define() {}, get: () => undefined };
  globalThis.document = {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    addEventListener() {},
    querySelector: () => null,
    getElementsByTagName: () => [],
    head: { appendChild() {} },
    body: { appendChild() {} },
  };

  const src = (await readFile(BUNDLE)).toString('base64');
  await import(`data:text/javascript;base64,${src}`);

  if (
    typeof globalThis.window.PagefindComponents !== 'object' ||
    globalThis.window.PagefindComponents === null
  ) {
    throw new GateError(
      'window.PagefindComponents is not defined after loading the bundle. ' +
        'The search page will build clean and never render.',
    );
  }

  const page = await readFile(PAGE, 'utf8');
  if (!page.includes('<pagefind-results')) {
    throw new GateError(`${PAGE} does not contain <pagefind-results>.`);
  }
  if (!page.includes(`/pagefind/${name}"`)) {
    throw new GateError(`${PAGE} does not reference /pagefind/${name}.`);
  }

  console.log('ok: search widget constructor is reachable');
}

await runMain(import.meta.url, main);
