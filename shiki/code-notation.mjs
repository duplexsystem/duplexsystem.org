import {
  transformerMetaHighlight,
  transformerNotationDiff,
  transformerNotationHighlight,
} from '@shikijs/transformers';

export const codeNotation = () => [
  transformerNotationDiff({ matchAlgorithm: 'v3' }),
  transformerNotationHighlight({ matchAlgorithm: 'v3' }),
  transformerMetaHighlight(),
];

const NOTE =
  /[ \t]*(?:\/\/|\/\*|#|;|--|<!--)[ \t]*\[!code[ \t]+(\+\+|--|highlight|hl)(?::(\d+))?\][ \t]*(?:\*\/|-->)?[ \t]*$/;

export function runnableSource(code) {
  let removing = 0;
  return code
    .split('\n')
    .flatMap((line) => {
      const m = NOTE.exec(line);
      if (m?.[1] === '--') removing = Math.max(removing, Number(m[2] ?? 1));
      if (removing > 0) {
        removing--;
        return [];
      }
      return [m ? line.slice(0, m.index) : line];
    })
    .join('\n');
}
