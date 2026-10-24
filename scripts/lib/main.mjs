import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const isMain = (metaUrl) =>
  Boolean(process.argv[1]) && fileURLToPath(metaUrl) === resolve(process.argv[1]);
