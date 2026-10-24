import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { includeDrafts, isDraft } from './lib/drafts';

const BLOG_DIR = new URL('./content/blog/', import.meta.url);

function draftExclusions(): string[] {
  if (import.meta.env.DEV || includeDrafts()) return [];
  return readdirSync(BLOG_DIR, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.mdx'))
    .filter((f) => isDraft(readFileSync(fileURLToPath(new URL(f, BLOG_DIR)), 'utf8')))
    .map((f) => `!${f}`);
}

const calendarDate = z.preprocess(
  (v) => {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      return new Date(`${v.slice(0, 10)}T00:00:00Z`);
    }
    return v;
  },
  z.date().refine((d) => d.getTime() % 86_400_000 === 0, {
    message: 'write the date as YYYY-MM-DD, or quote a timestamp so its own day is kept',
  }),
);

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: ['**/*.mdx', ...draftExclusions()] }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string().max(80),
        description: z.string().max(200),
        pubDate: calendarDate,
        updatedDate: calendarDate.optional(),
        tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
        draft: z.boolean().default(false),
        heroImage: image().optional(),
        heroAlt: z.string().optional(),
      })
      .refine((d) => !d.heroImage || typeof d.heroAlt === 'string', {
        message: 'heroAlt is required when heroImage is set (use "" if decorative)',
        path: ['heroAlt'],
      }),
});

export const collections = { blog };
