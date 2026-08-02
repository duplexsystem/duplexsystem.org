import { visit } from 'unist-util-visit';

const PLATFORM_LABEL = {
  BlueskyPost: 'bluesky',
  MastodonPost: 'mastodon',
  Tweet: 'twitter',
  YouTube: 'youtube',
  Vimeo: 'vimeo',
  LinkPreview: 'link',
};

const el = (tagName, properties, children = []) => ({
  type: 'element',
  tagName,
  properties,
  children,
});

const text = (value) => ({ type: 'text', value });

const bar = (label, meta) =>
  el('div', { className: ['frame__bar'] }, [
    el('span', { className: ['frame__label'] }, [text(label)]),
    ...(meta ? [el('span', { className: ['frame__meta'] }, [text(meta)])] : []),
  ]);

const significant = (children) => children.filter((c) => !(c.type === 'text' && !c.value.trim()));

/**
 * Wraps tables, lone images and astro-embed embeds in the shared panel chrome.
 *
 * Returns an *attacher*, not the transformer: astro.config.mjs calls this
 * factory with options, so unified's zero-arg call must land on the extra
 * layer. Collapse the layers and `transformer` runs with `tree` undefined.
 *
 * @param {{ embedNamespace?: string }} options
 */
export function rehypeFrame({ embedNamespace } = {}) {
  return function attacher() {
    return function transformer(tree) {
      visit(tree, (node, index, parent) => {
        if (!parent || index === null) return;

        if (node.type === 'element' && node.tagName === 'table') {
          if (
            parent.type === 'element' &&
            parent.properties?.className?.includes?.('frame__scroll')
          )
            return;

          const head = node.children.find((c) => c.tagName === 'thead');
          const firstRow = head?.children.find((c) => c.tagName === 'tr');
          const cols = firstRow ? firstRow.children.filter((c) => c.tagName === 'th').length : 0;

          parent.children[index] = el('figure', { className: ['frame'] }, [
            bar('table', cols ? `${cols} col${cols === 1 ? '' : 's'}` : ''),
            el('div', { className: ['frame__body'] }, [
              el(
                'div',
                {
                  className: ['frame__scroll'],
                  tabIndex: 0,
                  role: 'region',
                  'aria-label': cols ? `Table, ${cols} columns` : 'Table',
                },
                [node],
              ),
            ]),
          ]);
          return ['skip'];
        }

        if (node.type === 'element' && node.tagName === 'p') {
          const kids = significant(node.children);
          if (kids.length !== 1) return;
          const img = kids[0];
          if (img.type !== 'element' || img.tagName !== 'img') return;

          const alt = typeof img.properties?.alt === 'string' ? img.properties.alt : '';
          img.properties = {
            ...img.properties,
            loading: 'lazy',
            decoding: 'async',
          };

          parent.children[index] = el('figure', { className: ['frame'] }, [
            bar(alt || 'image', ''),
            el('div', { className: ['frame__body'] }, [img]),
          ]);
          return ['skip'];
        }

        if (
          node.type === 'mdxJsxFlowElement' &&
          typeof node.name === 'string' &&
          ((embedNamespace && node.name.startsWith(`${embedNamespace}_`)) ||
            node.name in PLATFORM_LABEL)
        ) {
          const component =
            embedNamespace && node.name.startsWith(`${embedNamespace}_`)
              ? node.name.slice(embedNamespace.length + 1)
              : node.name;
          if (component === 'Gist') return;

          const label = PLATFORM_LABEL[component] ?? component;

          const title = node.attributes?.find(
            (a) => a.type === 'mdxJsxAttribute' && a.name === 'title',
          );
          const titleText = typeof title?.value === 'string' ? title.value : '';

          parent.children[index] = el('figure', { className: ['frame', 'frame--embed'] }, [
            bar(titleText, label),
            el('div', { className: ['frame__body'] }, [node]),
          ]);
          return ['skip'];
        }
      });
    };
  };
}
