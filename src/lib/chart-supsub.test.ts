import { describe, expect, it } from 'vitest';
import { renderChart } from './chart.mjs';

const spec = (t: string) => ({
  data: { values: [{ x: 1 }] },
  mark: { type: 'text', text: t },
  encoding: { x: { field: 'x', type: 'quantitative' } },
});

describe('chart sup/sub', () => {
  it('raises ^sup^ and lowers ~sub~ in SVG text, shifting back after', async () => {
    const svg = await renderChart(spec('10^16^ and H~2~O'), 'label');
    expect(svg).toContain(
      '10<tspan dy="-0.5em" font-size="70%">16</tspan><tspan dy="0.35em"> and H</tspan>',
    );
    expect(svg).toContain(
      '<tspan dy="0.3em" font-size="70%">2</tspan><tspan dy="-0.21em">O</tspan>',
    );
  });

  it('leaves text without markers alone and drops markers from the aria-label', async () => {
    const svg = await renderChart(spec('2^53 is big'), '2^53^ chart');
    expect(svg).toContain('>2^53 is big</text>');
    expect(svg).toContain('aria-label="253 chart"');
  });
});

describe('captionHtml', () => {
  it('renders `code` spans, escapes them, and keeps ^sup^ and ~sub~ outside them', async () => {
    const { captionHtml } = await import('./supsub.mjs');
    expect(captionHtml('`xor` breaks a dependency; 10^19^ and `a<b`')).toBe(
      '<code>xor</code> breaks a dependency; 10<sup>19</sup> and <code>a&lt;b</code>',
    );
    expect(captionHtml('no code, H~2~O')).toBe('no code, H<sub>2</sub>O');
    expect(captionHtml('a lone ` stays')).toBe('a lone ` stays');
  });
});
