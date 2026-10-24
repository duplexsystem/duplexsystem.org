import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

export function sha256(...parts) {
  const h = createHash('sha256');
  for (const part of parts) h.update(part);
  return h.digest('hex');
}

export const hash8 = (bytes) => sha256(bytes).slice(0, 8);

export function hashedName(file, bytes) {
  const ext = extname(file);
  return `${basename(file, ext)}.${hash8(bytes)}${ext}`;
}
