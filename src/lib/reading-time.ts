export interface ReadingTime {
  words: number;
  minutes: number;
  wpm: number;
}

// Brysbaert (2019) meta-analysis: 238 wpm mean for adult non-fiction prose.
const BASE_WPM = 238;
const MIN_WPM = 150;
const MAX_WPM = 300;

const BASELINE_WORD_LENGTH = 4.9;

const LENGTH_EXPONENT = 0.821;

// Cognitive Complexity tracks comprehension time at r = 0.54 (Muñoz Barón,
// Wyrich & Wagner 2020); line count is the weakest predictor. Constant is
// calibrated, not measured.
const SECONDS_PER_COMPLEXITY_POINT = 4;

const SECONDS_PER_CODE_LINE = 0.9;

const SECONDS_PER_IMAGE = 8;

const FENCE_RE = /```[\s\S]*?```/g;
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;

const FLOW_BREAK_RE =
  /\b(if|elif|for|foreach|while|do|switch|match|case|when|catch|except|rescue|goto)\b/g;
const BOOLEAN_OP_RE = /(&&|\|\|)/g;

const LITERALS_RE = new RegExp(
  [
    String.raw`/\*[\s\S]*?\*/`, // block comments
    String.raw`//[^\n]*`, // line comments
    String.raw`^[ \t]*#[^\n]*`,
    String.raw`"""[\s\S]*?"""`, // python docstrings
    String.raw`'''[\s\S]*?'''`,
    String.raw`"(?:\\.|[^"\\])*"`, // double-quoted strings
    String.raw`'(?:\\.|[^'\\])*'`, // single-quoted strings
    String.raw`\`(?:\\.|[^\`\\])*\``, // template literals
  ].join('|'),
  'gm', // m: anchors the line-leading `#` rule per line, not per block
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
  const images = (markdown.match(IMAGE_RE) ?? []).length;

  const prose = markdown
    .replace(FENCE_RE, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(IMAGE_RE, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, ' ')
    .replace(/[*_~>#|]/g, ' ');

  const tokens = prose.split(/\s+/).filter(Boolean);
  const words = tokens.length;
  if (words === 0 && codeLines <= 0 && images === 0) {
    return { words: 0, minutes: 0, wpm: BASE_WPM };
  }

  const letters = tokens.reduce((n, t) => n + t.replace(/[^\p{L}\p{N}]/gu, '').length, 0);
  const avgLength = words > 0 ? letters / words : BASELINE_WORD_LENGTH;

  const adjusted = BASE_WPM * (BASELINE_WORD_LENGTH / Math.max(avgLength, 1)) ** LENGTH_EXPONENT;
  const wpm = Math.round(Math.min(MAX_WPM, Math.max(MIN_WPM, adjusted)));

  const seconds =
    (words / wpm) * 60 +
    Math.max(0, codeLines) * SECONDS_PER_CODE_LINE +
    codeComplexity * SECONDS_PER_COMPLEXITY_POINT +
    images * SECONDS_PER_IMAGE;

  return { words, minutes: Math.max(1, Math.round(seconds / 60)), wpm };
}
