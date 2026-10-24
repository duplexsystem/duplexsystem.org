import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import { defineConfig, fontProviders } from 'astro/config';
import mdx from '@astrojs/mdx';
import { unified, rehypeHeadingIds } from '@astrojs/markdown-remark';
import { parse as parseJs } from 'acorn';
import { visit } from 'unist-util-visit';
import createEmbedPlugin, {
  componentNames,
} from './node_modules/@astro-community/astro-embed-integration/remark-plugin.ts';
import sitemap from '@astrojs/sitemap';
import { frontmatterOf, includeDrafts } from './src/lib/drafts.ts';
import { updatedAfter } from './src/lib/last-edited.ts';
import { pagefindDev } from './integrations/pagefind-dev.mjs';
import violetDark from './shiki/violet-dark.json' with { type: 'json' };
import { codeblockHeader } from './shiki/codeblock-header.mjs';
import { codeNotation } from './shiki/code-notation.mjs';
import { tokenClasses } from './shiki/token-classes.mjs';
import { rehypeFrame } from './rehype/frame.mjs';
import { rehypeSearchNames } from './rehype/search-names.mjs';
import { rehypeHeadingAnchors } from './rehype/heading-anchors.mjs';
import { rehypeRunInHeadings } from './rehype/run-in-headings.mjs';
import { rehypeMathNowrap } from './rehype/math-nowrap.mjs';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import { remarkSupSub } from './rehype/remark-supsub.mjs';
import { remarkCallouts } from './rehype/remark-callouts.mjs';
import { remarkTableMeta } from './rehype/remark-table-meta.mjs';
import { remarkRunnable } from './rehype/remark-runnable.mjs';
import { remarkFlowchart } from './rehype/remark-flowchart.mjs';
import rehypeKatex from 'rehype-katex';

const importNamespace = 'AuToImPoRtEdAstroEmbed';

const EMBED_SOURCE = {
  BlueskyPost: { module: '/src/components/SocialPost.astro', default: true },
  Tweet: { module: '/src/components/SocialPost.astro', default: true },
  MastodonPost: { module: '/src/components/SocialPost.astro', default: true },
  Vimeo: { module: '@astro-community/astro-embed-vimeo' },
  YouTube: { module: '@astro-community/astro-embed-youtube' },
  LinkPreview: { module: '/src/components/LinkCard.astro', default: true },
  Gist: { module: '/src/components/Gist.astro', default: true },
};

function autoImportEmbeds(namespace, names) {
  return function attacher() {
    return function transformer(tree, vfile) {
      if (vfile.basename?.endsWith('.md')) return;

      const used = new Set();
      visit(tree, 'mdxJsxFlowElement', (node) => {
        if (typeof node.name !== 'string' || !node.name.startsWith(`${namespace}_`)) return;
        const component = node.name.slice(namespace.length + 1);
        if (names.includes(component)) used.add(component);
      });
      if (used.size === 0) return;

      const importLines = [...used].sort().map((name) => {
        const source = EMBED_SOURCE[name];
        return source.default
          ? `import ${namespace}_${name} from '${source.module}';`
          : `import { ${name} as ${namespace}_${name} } from '${source.module}';`;
      });

      const importsNode = {
        type: 'mdxjsEsm',
        value: '',
        data: {
          estree: parseJs(importLines.join('\n'), { ecmaVersion: 'latest', sourceType: 'module' }),
        },
      };
      tree.children.unshift(importsNode);
    };
  };
}

const FULL_FONTS = includeDrafts();
const FONTS = (() => {
  try {
    const manifest = new URL(
      `./src/assets/fonts/generated/${FULL_FONTS ? 'full/' : ''}fonts.json`,
      import.meta.url,
    );
    return JSON.parse(readFileSync(manifest, 'utf8'));
  } catch {
    return { weights: [400, 700], files: {} };
  }
})();
const DEFAULT_SPLIT = {
  core: 'U+0020-007E,U+00A0-00FF,U+2000-206F,U+2122,U+2190-2193,U+2212',
  ext: 'U+0100-017F,U+2070-209F,U+20A0-20BF,U+2500-257F,U+25A0-25FF',
};
const rangeOf = (spec) => spec.split(',').join(', ');

function splitFace(stem, variant) {
  const dir = './src/assets/fonts/generated';
  if (FULL_FONTS) return [{ ...variant, src: [`${dir}/full/${stem}.woff2`] }];
  const { core, ext } = FONTS.files?.[stem] ?? DEFAULT_SPLIT;
  return [
    { ...variant, unicodeRange: [rangeOf(core)], src: [`${dir}/${stem}-core.woff2`] },
    { ...variant, unicodeRange: [rangeOf(ext)], src: [`${dir}/${stem}-ext.woff2`] },
  ];
}

function postLastmod() {
  const dir = fileURLToPath(new URL('./src/content/blog/', import.meta.url));
  const dates = new Map();
  for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.mdx')) continue;
    const path = join(dir, file);
    const fm = frontmatterOf(readFileSync(path, 'utf8'));
    const data = fm ? loadYaml(fm) : null;
    const asDate = (d) =>
      typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)
        ? new Date(`${d.slice(0, 10)}T00:00:00Z`)
        : d === undefined
          ? undefined
          : new Date(d);
    const pub = asDate(data?.pubDate);
    const date = pub && (updatedAfter(pub, asDate(data?.updatedDate), path) ?? pub);
    if (date) {
      dates.set(`/blog/${file.replace(/\.mdx$/, '')}/`, date.toISOString().slice(0, 10));
    }
  }
  return dates;
}
const lastmod = postLastmod();

export default defineConfig({
  site: 'https://duplexsystem.org',
  output: 'static',
  integrations: [
    sitemap({
      filter: (page) => !new URL(page).pathname.startsWith('/errors/'),
      serialize(item) {
        const day = lastmod.get(new URL(item.url).pathname);
        return day ? { ...item, lastmod: day } : item;
      },
    }),
    mdx({ gfm: false }),
    pagefindDev(),
  ],
  build: {
    format: 'directory',
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      cssCodeSplit: false,
      assetsInlineLimit: (file) =>
        /[\\/]src[\\/]assets[\\/]icons[\\/]generated[\\/][^\\/]+\.svg$/.test(file),
    },
    resolve: {
      alias: [
        ...(FULL_FONTS
          ? [
              {
                find: /^(.*[\\/]fonts[\\/]generated)[\\/]noto-emoji\.woff2$/,
                replacement: '$1/full/noto-emoji.woff2',
              },
            ]
          : []),
        {
          find: /^@astro-community\/astro-embed-utils$/,
          replacement: fileURLToPath(new URL('./src/lib/embed-utils-shim.ts', import.meta.url)),
        },
      ],
    },
  },
  markdown: {
    processor: unified({
      gfm: false,
      remarkPlugins: [
        [remarkGfm, { singleTilde: false }],
        remarkCallouts(),
        createEmbedPlugin({
          importNamespace,
          enabledComponents: componentNames,
        }),
        autoImportEmbeds(importNamespace, componentNames),
        remarkMath,
        remarkSupSub,
        remarkTableMeta,
        remarkFlowchart({
          component: fileURLToPath(new URL('./src/components/Flowchart.astro', import.meta.url)),
        }),
        remarkRunnable({
          cacheDir: fileURLToPath(new URL('./.cache/runnable/', import.meta.url)),
          contentDir: fileURLToPath(new URL('./src/content/blog/', import.meta.url)),
        }),
      ],
      rehypePlugins: [
        [rehypeKatex, { strict: 'ignore' }],
        rehypeMathNowrap(),
        rehypeFrame({ embedNamespace: importNamespace }),
        rehypeSearchNames(),
        rehypeHeadingIds,
        rehypeHeadingAnchors(),
        rehypeRunInHeadings(),
      ],
    }),
    shikiConfig: {
      theme: violetDark,
      langAlias: { arm64: 'asm' },
      wrap: false,
      transformers: [...codeNotation(), codeblockHeader(), tokenClasses()],
    },
  },
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: {
        webp: { effort: 6, quality: 82 },
        avif: { effort: 6, quality: 72 },
        png: { compressionLevel: 9 },
      },
    },
  },
  fonts: [
    {
      name: 'Literata',
      cssVariable: '--font-literata',
      provider: fontProviders.local(),
      fallbacks: ['Georgia', 'serif'],
      options: {
        variants: [
          ...FONTS.weights.flatMap((weight) => [
            ...splitFace(`literata-roman-${weight}`, { weight, style: 'normal' }),
            ...splitFace(`literata-italic-${weight}`, { weight, style: 'italic' }),
          ]),
        ],
      },
    },
    {
      name: 'Departure Mono',
      cssVariable: '--font-departure',
      provider: fontProviders.local(),
      fallbacks: ['ui-monospace', 'monospace'],
      options: {
        variants: splitFace('departure-mono', { weight: 400, style: 'normal' }),
      },
    },
    {
      name: 'JetBrains Mono',
      cssVariable: '--font-jetbrains',
      provider: fontProviders.local(),
      fallbacks: ['ui-monospace', 'monospace'],
      options: {
        variants: [
          ...splitFace('jetbrains-mono', { weight: 400, style: 'normal' }),
          ...splitFace('jetbrains-mono-italic', { weight: 400, style: 'italic' }),
          ...splitFace('jetbrains-mono-bold', { weight: 700, style: 'normal' }),
        ],
      },
    },
  ],
});
