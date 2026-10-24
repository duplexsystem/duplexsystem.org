import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const utcDay = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));

const localDay = (t: Date): Date => utcDay(t.getFullYear(), t.getMonth() + 1, t.getDate());

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const cache = new Map<string, Date | undefined>();

export function lastEdited(file: string): Date | undefined {
  const abs = resolve(file);
  const stat = statSync(abs, { throwIfNoEntry: false });
  if (!stat) return undefined;
  const key = `${abs}\0${stat.mtimeMs}`;
  if (cache.has(key)) return cache.get(key);

  const cwd = dirname(abs);
  const name = basename(abs);
  let day: Date | undefined;
  const status = git(['status', '--porcelain', '--', name], cwd);
  if (status === null) {
    day = localDay(stat.mtime);
  } else if (status === '') {
    const d = git(['log', '--follow', '-1', '--diff-filter=M', '--format=%cs', '--', name], cwd);
    const m = d && /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    day = m ? utcDay(+m[1], +m[2], +m[3]) : undefined;
  } else {
    day = localDay(stat.mtime);
  }
  cache.set(key, day);
  return day;
}

export function updatedAfter(
  pubDate: Date,
  updatedDate: Date | undefined,
  file: string | undefined,
): Date | undefined {
  const day = updatedDate ?? (file ? lastEdited(file) : undefined);
  return day && day.getTime() > pubDate.getTime() ? day : undefined;
}
