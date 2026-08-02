import { fileURLToPath } from 'node:url';
import { defineConfig, fontProviders } from 'astro/config';
import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';
import { parse as parseJs } from 'acorn';
import { visit } from 'unist-util-visit';
import createEmbedPlugin, {
  componentNames,
} from './node_modules/@astro-community/astro-embed-integration/remark-plugin.ts';
import sitemap from '@astrojs/sitemap';
import { pagefindDev } from './integrations/pagefind-dev.mjs';
import violetDark from './shiki/violet-dark.json' with { type: 'json' };
import { codeblockHeader } from './shiki/codeblock-header.mjs';
import { rehypeFrame } from './rehype/frame.mjs';
import { rehypeSearchNames } from './rehype/search-names.mjs';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

const importNamespace = 'AuToImPoRtEdAstroEmbed';

// Sub-packages, not the `astro-embed` barrel: the barrel drags in
// BaselineStatus and four browser-logo SVGs.
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

export default defineConfig({
  site: 'https://duplexsystem.org',
  output: 'static',
  integrations: [sitemap({ filter: (page) => !page.includes('/errors/') }), mdx(), pagefindDev()],
  build: {
    format: 'directory',
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      cssCodeSplit: false,
      assetsInlineLimit: 0,
    },
    resolve: {
      alias: [
        {
          // On-disk cache in front of every embed fetch, so builds are
          // offline. Anchored, or it matches the shim's own import.
          find: /^@astro-community\/astro-embed-utils$/,
          replacement: fileURLToPath(new URL('./src/lib/embed-utils-shim.ts', import.meta.url)),
        },
      ],
    },
  },
  markdown: {
    processor: unified({
      remarkPlugins: [
        // Order matters: autoImportEmbeds walks the nodes this one emits.
        createEmbedPlugin({
          importNamespace,
          enabledComponents: componentNames,
        }),
        autoImportEmbeds(importNamespace, componentNames),
        remarkMath,
      ],
      rehypePlugins: [
        // Ahead of the rest: nothing downstream should walk KaTeX's internals.
        [rehypeKatex, { strict: 'ignore' }],
        rehypeFrame({ embedNamespace: importNamespace }),
        rehypeSearchNames(),
      ],
    }),
    shikiConfig: { theme: violetDark, wrap: false, transformers: [codeblockHeader()] },
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
          {
            weight: '200 900',
            style: 'normal',
            src: ['./src/assets/fonts/generated/literata-roman.woff2'],
          },
          {
            weight: '200 900',
            style: 'italic',
            src: ['./src/assets/fonts/generated/literata-italic.woff2'],
          },
        ],
      },
    },
    {
      name: 'Departure Mono',
      cssVariable: '--font-departure',
      provider: fontProviders.local(),
      fallbacks: ['ui-monospace', 'monospace'],
      options: {
        variants: [
          {
            weight: 400,
            style: 'normal',
            src: ['./src/assets/fonts/generated/departure-mono.woff2'],
          },
        ],
      },
    },
    {
      name: 'JetBrains Mono',
      cssVariable: '--font-jetbrains',
      provider: fontProviders.local(),
      fallbacks: ['ui-monospace', 'monospace'],
      options: {
        variants: [
          {
            weight: 400,
            style: 'normal',
            src: ['./src/assets/fonts/generated/jetbrains-mono.woff2'],
          },
          {
            weight: 700,
            style: 'normal',
            src: ['./src/assets/fonts/generated/jetbrains-mono-bold.woff2'],
          },
        ],
      },
    },
  ],
});
