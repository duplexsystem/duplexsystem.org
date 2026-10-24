export interface ReadingTime {
  words: number;
  minutes: number;
  wpm: number;
}

const BASE_WPM = 238;
const MIN_WPM = 150;
const MAX_WPM = 300;

const BASELINE_WORD_LENGTH = 4.9;

const LENGTH_EXPONENT = 0.821;

const SECONDS_PER_COMPLEXITY_POINT = 4;

const SECONDS_PER_CODE_LINE = 0.9;

const SECONDS_PER_IMAGE = 8;

const SECONDS_PER_MATH_SYMBOL = 1;

const TECHNICAL_SLOWDOWN = 1;

const FENCE_RE = /```[\s\S]*?```/g;
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const COMPONENT_RE = /<[A-Z][\w.]*\b[\s\S]*?\/>/g;
const IMPORT_RE = /^import\s[^\n]*$/gm;
const DISPLAY_MATH_RE = /\$\$[\s\S]*?\$\$/g;
const INLINE_MATH_RE = /\$[^$\n]+\$/g;
const CODE_SPAN_RE = /`[^`\n]+`/g;
const MATH_SYMBOL_RE = /\\[a-zA-Z]+|[a-zA-Z]+|\d+(?:\.\d+)?|[=<>+\-*/!|]/g;

const FLOW_BREAK_RE =
  /\b(if|elif|for|foreach|while|do|switch|match|case|when|catch|except|rescue|goto)\b/g;
const BOOLEAN_OP_RE = /(&&|\|\|)/g;

const LITERALS_RE = new RegExp(
  [
    String.raw`/\*[\s\S]*?\*/`,
    String.raw`//[^\n]*`,
    String.raw`^[ \t]*#[^\n]*`,
    String.raw`"""[\s\S]*?"""`,
    String.raw`'''[\s\S]*?'''`,
    String.raw`"(?:\\.|[^"\\])*"`,
    String.raw`'(?:\\.|[^'\\])*'`,
    String.raw`\`(?:\\.|[^\`\\])*\``,
  ].join('|'),
  'gm',
);

function stripLiterals(code: string): string {
  return code.replace(LITERALS_RE, (m) => m.replace(/[^\n]/g, ' '));
}

export function cognitiveComplexity(code: string): number {
  const lines = stripLiterals(code)
    .split('\n')
    .filter((l) => l.trim());
  if (lines.length === 0) return 0;

  const indentOf = (l: string) => l.match(/^[ \t]*/)![0].replace(/\t/g, '    ').length;

  const levels = [...new Set(lines.map(indentOf))].sort((a, b) => a - b);

  let score = 0;
  for (const line of lines) {
    const depth = levels.indexOf(indentOf(line));
    const breaks =
      (line.match(FLOW_BREAK_RE) ?? []).length + (line.match(BOOLEAN_OP_RE) ?? []).length;
    score += breaks * (1 + depth);
  }
  return score;
}

export function readingTime(markdown: string): ReadingTime {
  const codeBlocks = markdown.match(FENCE_RE) ?? [];
  const codeLines = codeBlocks.reduce(
    (n, block) => n + block.split('\n').filter((l) => l.trim()).length - 2,
    0,
  );
  const codeComplexity = codeBlocks.reduce((n, block) => {
    const body = block.split('\n').slice(1, -1).join('\n');
    return n + cognitiveComplexity(body);
  }, 0);
  const figures = markdown.replace(FENCE_RE, ' ').match(COMPONENT_RE) ?? [];
  const images = (markdown.match(IMAGE_RE) ?? []).length + figures.length;

  const unfenced = markdown
    .replace(FENCE_RE, ' ')
    .replace(COMPONENT_RE, ' ')
    .replace(IMPORT_RE, ' ');

  const spans = unfenced.match(CODE_SPAN_RE) ?? [];
  const spanWords = spans.reduce((n, s) => n + (s.match(/[\p{L}\p{N}_]+/gu) ?? []).length, 0);

  const outsideCode = unfenced.replace(CODE_SPAN_RE, ' ');
  const formulas = [
    ...(outsideCode.match(DISPLAY_MATH_RE) ?? []),
    ...(outsideCode.replace(DISPLAY_MATH_RE, ' ').match(INLINE_MATH_RE) ?? []),
  ];
  const mathSymbols = formulas.reduce((n, f) => n + (f.match(MATH_SYMBOL_RE) ?? []).length, 0);

  const prose = outsideCode
    .replace(DISPLAY_MATH_RE, ' ')
    .replace(INLINE_MATH_RE, ' ')
    .replace(IMAGE_RE, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, ' ')
    .replace(/[*_~>#|]/g, ' ');

  const tokens = prose.split(/\s+/).filter(Boolean);
  const words = tokens.length + spanWords;
  if (words === 0 && codeLines <= 0 && images === 0 && mathSymbols === 0) {
    return { words: 0, minutes: 0, wpm: BASE_WPM };
  }

  const wordish = tokens.filter((t) => /\p{L}/u.test(t));
  const letters = wordish.reduce((n, t) => n + t.replace(/[^\p{L}\p{N}]/gu, '').length, 0);
  const avgLength = wordish.length > 0 ? letters / wordish.length : BASELINE_WORD_LENGTH;

  const adjusted = BASE_WPM * (BASELINE_WORD_LENGTH / Math.max(avgLength, 1)) ** LENGTH_EXPONENT;
  const notation = words + mathSymbols > 0 ? (spanWords + mathSymbols) / (words + mathSymbols) : 0;
  const technical = adjusted / (1 + TECHNICAL_SLOWDOWN * notation);
  const wpm = Math.round(Math.min(MAX_WPM, Math.max(MIN_WPM, technical)));

  const seconds =
    (words / wpm) * 60 +
    Math.max(0, codeLines) * SECONDS_PER_CODE_LINE +
    codeComplexity * SECONDS_PER_COMPLEXITY_POINT +
    images * SECONDS_PER_IMAGE +
    mathSymbols * SECONDS_PER_MATH_SYMBOL;

  return { words, minutes: Math.max(1, Math.round(seconds / 60)), wpm };
}
