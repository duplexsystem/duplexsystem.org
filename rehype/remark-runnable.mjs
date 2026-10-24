import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relative, dirname, join } from 'node:path';
import { parse as parseJs } from 'acorn';
import { visit } from 'unist-util-visit';
import { buildRunnable, buildSharedLibc, libraryCalls } from '../scripts/runnable.mjs';
import { buildAsmRunnable, buildSharedX86, x86Calls } from '../scripts/runnable-asm.mjs';
import { armCalls, buildArmRunnable, buildSharedArm } from '../scripts/runnable-arm.mjs';
import { includeDrafts, isDraft } from '../src/lib/drafts.ts';
import { inlineLabel, linkOf, parseMeta, withoutHeader } from '../shiki/codeblock-header.mjs';
import { runnableSource } from '../shiki/code-notation.mjs';

const RUN = /\brun="([^"]+)"/;
const BLOCK = /^```(c|asm|arm64)\b([^\n]*)\n([\s\S]*?)\n```[ \t]*$/gm;
export function runnableBlocks(text) {
  return [...text.matchAll(BLOCK)]
    .filter((m) => RUN.test(m[2]))
    .map((m) => ({ lang: m[1], source: runnableSource(m[3]) }));
}

function siteBlocks(contentDir) {
  const withDrafts = process.env.NODE_ENV !== 'production' || includeDrafts();
  const blocks = { c: [], asm: [], arm64: [] };
  for (const f of readdirSync(contentDir, { recursive: true, encoding: 'utf8' })) {
    if (!f.endsWith('.mdx')) continue;
    const text = readFileSync(join(contentDir, f), 'utf8');
    if (!withDrafts && isDraft(text)) continue;
    for (const { lang, source } of runnableBlocks(text)) blocks[lang].push(source);
  }
  return blocks;
}

const importPath = (from, to) => {
  const p = relative(dirname(from), to);
  return p.startsWith('.') ? p : `./${p}`;
};

const shipped = (path) => {
  const bytes = readFileSync(path);
  const name = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const dir = join(dirname(path), 'shipped');
  const out = join(dir, `${name}.wasm`);
  if (!existsSync(out)) {
    mkdirSync(dir, { recursive: true });
    copyFileSync(path, out);
  }
  return out;
};

const attr = (name, value) => ({ type: 'mdxJsxAttribute', name, value });
const jsx = (name, attrs, children = []) => ({
  type: 'mdxJsxFlowElement',
  name,
  attributes: Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => (typeof v === 'object' ? v : attr(k, v === true ? null : String(v)))),
  children: children.map((c) => (typeof c === 'string' ? { type: 'text', value: c } : c)),
});

const BUTTONS = [
  ['reset', 'reset'],
  ['back', 'back'],
  ['step', 'step'],
  ['run', 'run'],
];

function runbar(spec, wasmId, libcId, x86Id, arm64Id) {
  const call = spec.registers
    ? []
    : [jsx('span', { class: 'runbar__fn' }, [spec.fn]), jsx('span', { class: 'runbar__p' }, ['('])];
  spec.params.forEach((p, i) => {
    if (i) call.push(jsx('span', { class: 'runbar__p' }, [', ']));
    if (spec.registers) {
      call.push(
        jsx('span', { class: 'runbar__reg' }, [p.name]),
        jsx('span', { class: 'runbar__p' }, ['\u00a0=\u00a0']),
      );
    }
    call.push(
      jsx('input', {
        class: 'runbar__arg',
        value: p.default,
        'aria-label': `${p.name} (${p.type})`,
        title: `${p.name}: ${p.type}`,
        spellcheck: 'false',
        autocomplete: 'off',
        style: `width:${Math.min(24, Math.max(6, p.default.length + 2))}ch`,
      }),
    );
  });
  if (!spec.registers) call.push(jsx('span', { class: 'runbar__p' }, [')']));
  return jsx(
    'div',
    {
      class: 'runbar',
      'data-pagefind-ignore': true,
      'data-spec': JSON.stringify(spec),
      'data-wasm': exprAttr('data-wasm', wasmId),
      'data-libc': libcId ? exprAttr('data-libc', libcId) : undefined,
      'data-x86': x86Id ? exprAttr('data-x86', x86Id) : undefined,
      'data-arm64': arm64Id ? exprAttr('data-arm64', arm64Id) : undefined,
    },
    [
      jsx('span', { class: 'runbar__call' }, call),
      jsx(
        'span',
        { class: 'runbar__ctl' },
        BUTTONS.map(([name, label]) =>
          jsx(
            'button',
            {
              type: 'button',
              class: `runbar__btn runbar__btn--${name}`,
              'aria-label': label,
              title: label,
              disabled: true,
            },
            [],
          ),
        ),
      ),
    ],
  );
}

const label = (value = '') => {
  const link = linkOf(value);
  return link ? [jsx('a', { href: link.href, rel: 'noopener' }, [link.text])] : [value];
};

function codehead(meta) {
  const { title, dir } = parseMeta(meta);
  if (!title && !dir) return null;
  return jsx('figcaption', { class: 'codehead' }, [
    jsx('span', { class: 'codehead__title' }, label(title)),
    jsx('span', { class: 'codehead__dir' }, label(dir)),
  ]);
}

function codefoot(meta) {
  const { footer } = parseMeta(meta);
  if (!footer) return null;
  return jsx(
    'footer',
    { class: 'codefoot' },
    inlineLabel(footer).map((n) =>
      n.type === 'text' ? n.value : jsx('a', n.properties, [n.children[0].value]),
    ),
  );
}

const runfoot = () =>
  jsx('div', { class: 'runfoot', 'data-pagefind-ignore': true }, [
    jsx('span', { class: 'runfoot__text', role: 'status' }, ['step or run']),
    jsx('span', { class: 'runfoot__count', 'aria-hidden': 'true' }),
  ]);

const exprAttr = (name, id) => ({
  type: 'mdxJsxAttribute',
  name,
  value: {
    type: 'mdxJsxAttributeValueExpression',
    value: id,
    data: { estree: parseJs(id, { ecmaVersion: 'latest', sourceType: 'module' }) },
  },
});

export function remarkRunnable({ cacheDir, contentDir }) {
  return () => (tree, file) => {
    const found = [];
    const cSources = [];
    visit(tree, 'code', (node, index, parent) => {
      if (node.lang === 'c' || node.lang === 'cpp') cSources.push(runnableSource(node.value));
      const call = ['c', 'asm', 'arm64'].includes(node.lang) && RUN.exec(node.meta ?? '')?.[1];
      if (!call || !parent || index === undefined) return;
      found.push({ node, index, parent, call });
    });
    if (found.length === 0) return;
    const ofLang = (lang) =>
      found.filter((f) => f.node.lang === lang).map((f) => runnableSource(f.node.value));
    const site = siteBlocks(contentDir);

    const offered = new Map();
    for (const src of [...site.c, ...ofLang('c')]) {
      for (const fn of libraryCalls(src, { cacheDir })) offered.set(fn.name, fn);
    }
    const lib = buildSharedLibc([...offered.keys()], { cacheDir });
    const instructions = new Set();
    for (const src of [...site.asm, ...ofLang('asm')]) {
      try {
        for (const fn of x86Calls(src)) instructions.add(fn);
      } catch {
      }
    }
    const x86 = ofLang('asm').length ? buildSharedX86([...instructions], { cacheDir }) : null;
    const armInstructions = new Set();
    for (const src of [...site.arm64, ...ofLang('arm64')]) {
      try {
        for (const fn of armCalls(src)) armInstructions.add(fn);
      } catch {
      }
    }
    const arm64 = ofLang('arm64').length
      ? buildSharedArm([...armInstructions], { cacheDir })
      : null;

    const imports = [];
    let usesLibc = false;
    let usesX86 = false;
    let usesArm64 = false;
    for (const [i, { node, index, parent, call }] of [...found.entries()].reverse()) {
      const asm = node.lang === 'asm';
      const source = runnableSource(node.value);
      const { key, spec } = asm
        ? buildAsmRunnable(source, call, { cacheDir, cSources })
        : node.lang === 'arm64'
          ? buildArmRunnable(source, call, { cacheDir, cSources })
          : buildRunnable(source, call, {
              cacheDir,
              shared: libraryCalls(source, { cacheDir }).filter((fn) =>
                lib?.names.includes(fn.name),
              ),
            });
      usesLibc ||= spec.libc;
      const needsX86 = asm && spec.x86.length > 0;
      usesX86 ||= needsX86;
      const needsArm64 = node.lang === 'arm64' && spec.arm64.length > 0;
      usesArm64 ||= needsArm64;
      const missing = needsArm64 ? spec.arm64.filter((fn) => !arm64?.names.includes(fn)) : [];
      if (missing.length) {
        throw new Error(
          `runnable arm64: ${spec.fn} calls ${missing.join(', ')}, which armCalls (scripts/runnable-arm.mjs) did not find`,
        );
      }
      const id = `__runnable_${i}`;
      imports.unshift(
        `import ${id} from '${importPath(file.path, shipped(join(cacheDir, `${key}.wasm`)))}?url';`,
      );
      const head = codehead(node.meta ?? '');
      const foot = codefoot(node.meta ?? '');
      node.meta = `${withoutHeader(node.meta ?? '')} runnable`;
      const bar = runbar(
        spec,
        id,
        spec.libc ? '__runnable_libc' : null,
        needsX86 ? '__runnable_x86' : null,
        needsArm64 ? '__runnable_arm64' : null,
      );
      if (head || foot) {
        parent.children[index] = jsx(
          'figure',
          { class: 'codefig' },
          [head, bar, node, runfoot(), foot].filter(Boolean),
        );
      } else {
        parent.children.splice(index + 1, 0, runfoot());
        parent.children.splice(index, 0, bar);
      }
    }
    if (usesArm64) {
      imports.unshift(
        `import __runnable_arm64 from '${importPath(file.path, shipped(arm64.path))}?url';`,
      );
    }
    if (usesX86) {
      imports.unshift(
        `import __runnable_x86 from '${importPath(file.path, shipped(x86.path))}?url';`,
      );
    }
    if (usesLibc) {
      imports.unshift(
        `import __runnable_libc from '${importPath(file.path, shipped(lib.path))}?url';`,
      );
    }
    tree.children.unshift({
      type: 'mdxjsEsm',
      value: '',
      data: {
        estree: parseJs(imports.join('\n'), { ecmaVersion: 'latest', sourceType: 'module' }),
      },
    });
  };
}
