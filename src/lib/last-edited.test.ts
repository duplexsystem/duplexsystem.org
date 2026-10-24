import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lastEdited, updatedAfter } from './last-edited';

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const localNoon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

let repo: string;
let commitDate = '2026-03-04T10:00:00+00:00';
const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
      GIT_COMMITTER_DATE: commitDate,
      GIT_AUTHOR_DATE: commitDate,
    },
  });

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'last-edited-'));
  git('init', '-q');
  writeFileSync(join(repo, 'committed.mdx'), 'a');
  writeFileSync(join(repo, 'modified.mdx'), 'a');
  writeFileSync(join(repo, 'added.mdx'), 'a');
  writeFileSync(join(repo, 'moving.mdx'), 'one\ntwo\nthree\nfour\nfive\n');
  git('add', '.');
  git('commit', '-q', '-m', 'posts');
  commitDate = '2026-03-09T10:00:00+00:00';
  writeFileSync(join(repo, 'committed.mdx'), 'edited');
  writeFileSync(join(repo, 'moving.mdx'), 'one\ntwo edited\nthree\nfour\nfive\n');
  git('commit', '-q', '-am', 'an edit');
  commitDate = '2026-03-12T10:00:00+00:00';
  mkdirSync(join(repo, 'a folder'));
  git('mv', 'moving.mdx', 'a folder/é moved.mdx');
  git('commit', '-q', '-m', 'a rename');
  writeFileSync(join(repo, 'modified.mdx'), 'b');
  writeFileSync(join(repo, 'untracked.mdx'), 'a');
  for (const f of ['committed.mdx', 'added.mdx', 'modified.mdx', 'untracked.mdx']) {
    utimesSync(join(repo, f), localNoon(2026, 5, 6), localNoon(2026, 5, 6));
  }
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('lastEdited', () => {
  it('dates a committed, unchanged file by its last commit that edited it, not its mtime', () => {
    expect(lastEdited(join(repo, 'committed.mdx'))).toEqual(day('2026-03-09'));
  });
  it('gives nothing for a file only ever added: arriving in git is not an edit', () => {
    expect(lastEdited(join(repo, 'added.mdx'))).toBeUndefined();
  });
  it('dates a file with uncommitted changes by its mtime', () => {
    expect(lastEdited(join(repo, 'modified.mdx'))).toEqual(day('2026-05-06'));
  });
  it('dates a file never committed by its mtime', () => {
    expect(lastEdited(join(repo, 'untracked.mdx'))).toEqual(day('2026-05-06'));
  });
  it('keeps the edits of a renamed file: the rename is no edit, and loses none', () => {
    expect(lastEdited(join(repo, 'a folder', 'é moved.mdx'))).toEqual(day('2026-03-09'));
  });
  it('gives nothing for a file that does not exist', () => {
    expect(lastEdited(join(repo, 'missing.mdx'))).toBeUndefined();
  });
});

describe('updatedAfter', () => {
  const file = () => join(repo, 'committed.mdx');
  it('shows an edit made after the post was published', () => {
    expect(updatedAfter(day('2026-03-01'), undefined, file())).toEqual(day('2026-03-09'));
  });
  it('hides an edit from the day of publishing or before', () => {
    expect(updatedAfter(day('2026-03-09'), undefined, file())).toBeUndefined();
    expect(updatedAfter(day('2026-04-01'), undefined, file())).toBeUndefined();
  });
  it('prefers updatedDate from the frontmatter, with the same rule', () => {
    expect(updatedAfter(day('2026-03-01'), day('2026-03-02'), file())).toEqual(day('2026-03-02'));
    expect(updatedAfter(day('2026-03-02'), day('2026-03-02'), file())).toBeUndefined();
  });
});
