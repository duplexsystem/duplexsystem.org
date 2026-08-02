import * as vega from 'vega';
import { compile } from 'vega-lite';

/**
 * Vega-Lite theme mirroring src/styles/tokens.css. Vega bakes colors into SVG
 * attributes at build time and cannot read CSS custom properties, so these are
 * literals; keep them in sync by hand.
 *
 * Keys must be Vega-Lite's (`config.mark`, `config.line`), not Vega's
 * per-mark-type names (`config.rect`, `config.arc`): `compile()` ignores those
 * and bakes its own default blue onto every mark instead.
 */
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
    // Vega-Lite's default band step (20) is too narrow for a 10px JetBrains
    // Mono label: glyphs advance 6 units, so a 5-character label overlaps its
    // neighbour. The collision is geometric, so scaling the SVG does not help.
    // continuousWidth is pinned so chart size can't drift with vega-lite's own
    // default. A spec's explicit `width` still wins over both.
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
    .replace(/\swidth="[^"]*"/, '')
    .replace(/\sheight="[^"]*"/, '')
    .replace(
      '<svg',
      `<svg role="img" aria-label="${String(label).replace(/"/g, '&quot;')}" preserveAspectRatio="xMidYMid meet"`,
    );

  return svg;
}
