import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BLOG_DIR = new URL('./content/blog/', import.meta.url);

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const DRAFT = /^draft:\s*true\s*$/m;

function draftExclusions(): string[] {
  if (import.meta.env.DEV || process.env.INCLUDE_DRAFTS) return [];
  return readdirSync(BLOG_DIR, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.mdx'))
    .filter((f) => {
      const fm = FRONTMATTER.exec(readFileSync(fileURLToPath(new URL(f, BLOG_DIR)), 'utf8'));
      // Anchored to the frontmatter block, never the body: a post that writes
      // *about* `draft: true` must not exclude itself from the site.
      return !!fm && DRAFT.test(fm[1]);
    })
    .map((f) => `!${f}`);
}

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: ['**/*.mdx', ...draftExclusions()] }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string().max(80),
        description: z.string().max(200),
        pubDate: z.coerce.date(),
        updatedDate: z.coerce.date().optional(),
        tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
        draft: z.boolean().default(false),
        heroImage: image().optional(),
        heroAlt: z.string().optional(),
      })
      // A hero without alt text is an accessibility hole that no reviewer will
      // catch later. Fail the build instead. Decorative heroes pass "" explicitly.
      .refine((d) => !d.heroImage || typeof d.heroAlt === 'string', {
        message: 'heroAlt is required when heroImage is set (use "" if decorative)',
        path: ['heroAlt'],
      }),
});

export const collections = { blog };
