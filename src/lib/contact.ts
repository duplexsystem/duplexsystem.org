import yaml from 'js-yaml';
import { z } from 'astro/zod';
import source from '../data/contact.yaml?raw';

const schema = z.object({
  keylen: z.number().int().positive(),
  cipher: z
    .string()
    .regex(/^[0-9a-f]+$/, 'cipher must be lowercase hex')
    .min(2),
  check: z.string().regex(/^[0-9a-f]{8}$/, 'check must be 8 hex digits (FNV-1a)'),
});

export const contact = schema.parse(yaml.load(source));
