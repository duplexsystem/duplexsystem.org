import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function cached(dir, name, produce) {
  const file = join(dir, name);
  try {
    return await readFile(file);
  } catch {
  }
  const bytes = await produce();
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${process.pid}.${Math.random().toString(36).slice(2)}.${name}`);
  await writeFile(tmp, bytes);
  await rename(tmp, file);
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}
