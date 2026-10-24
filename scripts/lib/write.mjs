import { readFileSync, writeFileSync } from 'node:fs';

export function writeIfChanged(path, data) {
  const bytes = typeof data === 'string' ? Buffer.from(data) : data;
  try {
    if (readFileSync(path).equals(bytes)) return false;
  } catch {
  }
  writeFileSync(path, bytes);
  return true;
}
