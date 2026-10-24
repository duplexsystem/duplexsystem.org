import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, iconSvg } from './gen_pixel_icons.mjs';
import { ICONS } from '../src/assets/icons/pixel-icons.mjs';

describe('iconSvg', () => {
  it('merges each row’s runs of ink into one rectangle', () => {
    expect(iconSvg(['#.##', '####'])).toContain('d="M0 0h1v1H0zM2 0h2v1H2zM0 1h4v1H0z"');
    expect(iconSvg(['#.##', '####'])).toContain('viewBox="0 0 4 2"');
  });

  it('rejects anything but # and .', () => {
    expect(() => iconSvg(['#x#'])).toThrow(/only # and \./);
  });

  it('rejects rows of unequal width, which would draw a lopsided icon', () => {
    expect(() => iconSvg(['#.', '###'])).toThrow(/differ in width \(2, 3\)/);
    expect(() => iconSvg([])).toThrow(/no rows/);
  });

  it('names the icon that failed', () => {
    expect(() => generate({ bad: ['#', '##'] }, mkdtempSync(join(tmpdir(), 'icons-')))).toThrow(
      /^bad: /,
    );
  });

  it('leaves an unchanged file untouched and drops a stale one', () => {
    const out = mkdtempSync(join(tmpdir(), 'icons-'));
    try {
      generate({ a: ['#.'] }, out);
      writeFileSync(join(out, 'old.svg'), '');
      utimesSync(join(out, 'a.svg'), 1, 1);
      generate({ a: ['#.'] }, out);
      expect(statSync(join(out, 'a.svg')).mtimeMs).toBe(1000);
      expect(() => statSync(join(out, 'old.svg'))).toThrow();
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('keeps every icon’s rows the same width', () => {
    for (const [name, rows] of Object.entries(ICONS)) {
      expect(new Set(rows.map((r) => r.length)).size, name).toBe(1);
    }
  });
});
