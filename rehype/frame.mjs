import { visit, SKIP } from 'unist-util-visit';
import { label as linkLabel } from '../shiki/codeblock-header.mjs';
import { supsubSegments } from '../src/lib/supsub.mjs';

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

const tableBar = (title, dir) =>
  el('div', { className: ['frame__bar'] }, [
    el('span', { className: ['frame__label'] }, linkLabel(title)),
    ...(dir ? [el('span', { className: ['frame__meta'] }, linkLabel(dir))] : []),
  ]);

const captionNodes = (value) =>
  String(value)
    .split(/(`[^`]+`)/)
    .flatMap((part) =>
      /^`[^`]+`$/.test(part)
        ? [el('code', {}, [text(part.slice(1, -1))])]
        : supsubSegments(part).map((seg) =>
            seg.type === 'text' ? text(seg.value) : el(seg.type, {}, [text(seg.value)]),
          ),
    );

const significant = (children) => children.filter((c) => !(c.type === 'text' && !c.value.trim()));

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

          const {
            dataTitle: title,
            dataDir: dir,
            dataCaption: caption,
            ...props
          } = node.properties ?? {};
          node.properties = props;
          parent.children[index] = el('figure', { className: ['frame'] }, [
            ...(title || dir ? [tableBar(title ?? '', dir)] : []),
            el('div', { className: ['frame__body'] }, [
              el(
                'div',
                {
                  className: ['frame__scroll'],
                  tabIndex: 0,
                  role: 'region',
                  'aria-label': title
                    ? String(title).replace(/^\[([^\]]+)\]\(.*\)$/, '$1')
                    : cols
                      ? `Table, ${cols} columns`
                      : 'Table',
                },
                [node],
              ),
            ]),
            ...(caption ? [el('figcaption', {}, captionNodes(caption))] : []),
          ]);
          return SKIP;
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
          return SKIP;
        }

        if (
          node.type === 'mdxJsxFlowElement' &&
          typeof node.name === 'string' &&
          ((embedNamespace && node.name.startsWith(`${embedNamespace}_`)) ||
            Object.hasOwn(PLATFORM_LABEL, node.name))
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
          return SKIP;
        }
      });
    };
  };
}
