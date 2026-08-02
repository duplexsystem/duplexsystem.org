import { describe, it, expect } from 'vitest';
import { parseProjects } from './projects';

describe('parseProjects', () => {
  it('parses a project list', () => {
    const projects = parseProjects(
      'projects:\n  - name: thing\n    href: https://example.com\n    note: a thing\n',
    );
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('thing');
    expect(projects[0].note).toBe('a thing');
  });

  it('treats note as optional', () => {
    const projects = parseProjects('projects:\n  - name: thing\n    href: https://example.com\n');
    expect(projects[0].note).toBeUndefined();
  });

  it('defaults an empty file to no projects', () => {
    expect(parseProjects('')).toEqual([]);
  });

  it('rejects a relative href: these all point off-site', () => {
    expect(() => parseProjects('projects:\n  - name: x\n    href: /local\n')).toThrow(
      /absolute URL/,
    );
  });
});
