import { describe, it, expect } from 'vitest';
import { parseButtons, assertSingleOwnButton } from './buttons';

const yaml = `
buttons:
  - name: a friend
    href: https://friend.example
    img: /buttons/friend.png
`;

describe('parseButtons', () => {
  it('parses the button list', () => {
    const data = parseButtons(yaml);
    expect(data.buttons).toHaveLength(1);
    expect(data.buttons[0].name).toBe('a friend');
  });

  it('defaults a missing button list to an empty array', () => {
    expect(parseButtons('{}')).toEqual({ buttons: [] });
  });

  it("defaults a button's `own` flag to false when absent", () => {
    const data = parseButtons(yaml);
    expect(data.buttons[0].own).toBe(false);
  });

  it('rejects a button missing its image', () => {
    expect(() => parseButtons('buttons:\n  - name: x\n    href: https://x.example\n')).toThrow(
      /img is required/,
    );
  });

  it('rejects a button with an empty image path', () => {
    expect(() =>
      parseButtons("buttons:\n  - name: x\n    href: https://x.example\n    img: ''\n"),
    ).toThrow(/img cannot be empty/);
  });

  it('accepts a button with no href: not every button links anywhere', () => {
    const data = parseButtons('buttons:\n  - name: x\n    img: /x.png\n');
    expect(data.buttons[0].href).toBeUndefined();
  });

  it('rejects a non-absolute href', () => {
    expect(() =>
      parseButtons('buttons:\n  - name: x\n    href: notaurl\n    img: /x.png\n'),
    ).toThrow(/href/);
  });
});

describe('assertSingleOwnButton', () => {
  const button = (name: string, own?: boolean) =>
    `  - name: ${name}\n    href: https://${name}.example\n    img: /${name}.png\n` +
    (own === undefined ? '' : `    own: ${own}\n`);

  it('throws when no button is marked own', () => {
    const { buttons } = parseButtons(`buttons:\n${button('a')}`);
    expect(() => assertSingleOwnButton(buttons)).toThrow(/exactly one button/);
  });

  it('throws when more than one button is marked own', () => {
    const { buttons } = parseButtons(`buttons:\n${button('a', true)}${button('b', true)}`);
    expect(() => assertSingleOwnButton(buttons)).toThrow(/exactly one button/);
  });

  it('does not throw when exactly one button is marked own', () => {
    const { buttons } = parseButtons(`buttons:\n${button('a', true)}${button('b', false)}`);
    expect(() => assertSingleOwnButton(buttons)).not.toThrow();
  });
});
