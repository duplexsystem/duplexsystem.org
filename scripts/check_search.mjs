#!/usr/bin/env node
import { readFile, access } from 'node:fs/promises';

const bundlePath = (dist) => `${dist}/pagefind/pagefind-component-ui.js`;
const pagePath = (dist) => `${dist}/search/index.html`;

async function main(distDir = 'dist') {
  const BUNDLE = bundlePath(distDir);
  const PAGE = pagePath(distDir);
  try {
    await access(BUNDLE);
  } catch {
    console.error(`FAIL: ${BUNDLE} missing. Did pagefind run?`);
    process.exit(1);
  }

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
    console.error(
      'FAIL: window.PagefindComponents is not defined after loading the bundle. ' +
        'The search page will build clean and never render.',
    );
    process.exit(1);
  }

  const page = await readFile(PAGE, 'utf8');
  if (!page.includes('<pagefind-results')) {
    console.error(`FAIL: ${PAGE} does not contain <pagefind-results>.`);
    process.exit(1);
  }
  if (!page.includes('pagefind-component-ui.js')) {
    console.error(`FAIL: ${PAGE} does not reference pagefind-component-ui.js.`);
    process.exit(1);
  }

  console.log('ok: search widget constructor is reachable');
}

await main(process.argv[2]);
