import { describe, expect, it } from 'vitest';
import { securityTxt } from './security_txt.mjs';

describe('securityTxt', () => {
  const body = securityTxt(new Date('2026-10-11T15:30:00Z'));

  it('carries the fields RFC 9116 requires', () => {
    expect(body).toMatch(/^Contact: mailto:\S+@\S+$/m);
    expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T00:00:00\.000Z$/m);
  });

  it('expires under a year after the build', () => {
    const expires = new Date(/^Expires: (.+)$/m.exec(body)[1]);
    const days = (expires - new Date('2026-10-11T15:30:00Z')) / 86_400_000;
    expect(days).toBeGreaterThan(300);
    expect(days).toBeLessThan(365);
  });
});
