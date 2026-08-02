import yaml from 'js-yaml';
import { z } from 'astro/zod';

const entrySchema = z.object({
  code: z.string().regex(/^\d{3}$/, 'code must be a 3-digit HTTP status'),
  name: z.string().min(1),
  meta: z.string().min(1),
  message: z.string().min(1),
});
export type ErrorEntry = z.infer<typeof entrySchema>;

const sources = import.meta.glob('../data/errors/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const errorEntries: ErrorEntry[] = Object.entries(sources).map(([path, raw]) => {
  try {
    return entrySchema.parse(yaml.load(raw));
  } catch (cause) {
    throw new Error(`${path}: invalid error-page data`, { cause });
  }
});
