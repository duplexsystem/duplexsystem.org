import { describe, expect, it } from 'vitest';
import { hasCodeBlock } from './code-fences';

describe('hasCodeBlock', () => {
  it('finds a code block in either fence style, indented too', () => {
    expect(hasCodeBlock('text\n```c\nint x;\n```\n')).toBe(true);
    expect(hasCodeBlock('- item\n  ~~~\n  plain\n  ~~~\n')).toBe(true);
  });
  it('does not count a flowchart fence, or its closing fence, as code', () => {
    expect(hasCodeBlock('~~~flowchart title="x"\nA --> B\n~~~\n')).toBe(false);
    expect(hasCodeBlock('```flowchart\nA\n```\nprose\n')).toBe(false);
  });
  it('still finds code after a flowchart', () => {
    expect(hasCodeBlock('```flowchart\nA\n```\n\n```asm\nret\n```\n')).toBe(true);
  });
  it('ignores a fence-looking line inside a flowchart fence', () => {
    expect(hasCodeBlock('````flowchart\nA["```"]\n````\n')).toBe(false);
  });
  it('finds nothing in prose', () => {
    expect(hasCodeBlock('no code here, just `inline`.')).toBe(false);
  });
});
