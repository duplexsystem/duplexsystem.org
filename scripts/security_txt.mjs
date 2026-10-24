#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isMain } from './lib/main.mjs';
import { SITE } from './lib/site.mjs';

const CONTACT = 'mailto:admin@duplexsystem.org';
const VALID_DAYS = 364;

export function securityTxt(now = new Date()) {
  const expires = new Date(now.getTime() + VALID_DAYS * 86_400_000);
  expires.setUTCHours(0, 0, 0, 0);
  return [
    `Contact: ${CONTACT}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en',
    `Canonical: ${SITE}/.well-known/security.txt`,
    '',
  ].join('\n');
}

export default async function writeSecurityTxt(distDir = 'dist') {
  const dir = join(distDir, '.well-known');
  await mkdir(dir, { recursive: true });
  const body = securityTxt();
  await writeFile(join(dir, 'security.txt'), body);
  console.log(`security.txt: ${body.split('\n')[1]}`);
}

if (isMain(import.meta.url)) {
  await writeSecurityTxt(process.argv[2]);
}
