import * as vega from 'vega';
import { compile } from 'vega-lite';
import { supsubPlain, supsubSegments } from './supsub.mjs';

const THEME = {
  background: null,
  font: 'JetBrains Mono',
  mark: { color: '#b48cff' },
  line: { strokeWidth: 2 },
  axis: {
    domainColor: 'rgba(255,255,255,0.18)',
    gridColor: 'rgba(255,255,255,0.07)',
    tickColor: 'rgba(255,255,255,0.18)',
    labelColor: '#877c9c',
    titleColor: '#ddd4ea',
    labelFontSize: 10,
    titleFontSize: 11,
    titleFontWeight: 'normal',
  },
  legend: {
    labelColor: '#877c9c',
    titleColor: '#ddd4ea',
    labelFontSize: 10,
    titleFontSize: 11,
    titleFontWeight: 'normal',
  },
  title: { color: '#ddd4ea', fontSize: 13, fontWeight: 'normal' },
  view: {
    stroke: 'transparent',
    continuousWidth: 300,
    discreteWidth: { step: 60 },
  },
  range: {
    category: ['#b48cff', '#7f6ad6', '#e0a3ff', '#5b4a9e', '#c9b8f0', '#3b2f6b'],
    ramp: ['#2f1f4d', '#b48cff'],
  },
};

export async function renderChart(spec, label) {
  const vgSpec = compile({ ...spec, config: { ...THEME, ...(spec.config ?? {}) } }).spec;
  const view = new vega.View(vega.parse(vgSpec), { renderer: 'none' });
  let svg = await view.toSVG();
  view.finalize();

  if (/<script/i.test(svg)) {
    throw new Error('chart: Vega emitted a <script> element; refusing to inline it');
  }

  svg = svg
    .replace(
      /(<text\b[^>]*>)([^<]*)(<\/text>)/g,
      (_, open, text, close) => open + raise(text) + close,
    )
    .replace(/\swidth="[^"]*"/, '')
    .replace(/\sheight="[^"]*"/, '')
    .replace(
      '<svg',
      `<svg role="img" aria-label="${supsubPlain(String(label)).replace(/"/g, '&quot;')}" preserveAspectRatio="xMidYMid meet"`,
    );

  return svg;
}

const SMALL = 0.7;
const SHIFT = { sup: -0.5, sub: 0.3 };

function raise(text) {
  const parts = supsubSegments(text);
  if (parts.length === 1 && parts[0].type === 'text') return text;
  let out = '';
  let offset = 0;
  for (const p of parts) {
    if (p.type === 'text') {
      out += offset ? `<tspan dy="${-offset}em">${p.value}</tspan>` : p.value;
      offset = 0;
    } else {
      const dy = SHIFT[p.type] * SMALL - offset;
      out += `<tspan dy="${+(dy / SMALL).toFixed(3)}em" font-size="${SMALL * 100}%">${p.value}</tspan>`;
      offset = SHIFT[p.type] * SMALL;
    }
  }
  return out;
}
