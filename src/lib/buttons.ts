import yaml from 'js-yaml';
import { z } from 'astro/zod';
// ?raw, not node:fs: Astro stages SSR chunks without their sibling data files.
import buttonsSource from '../data/buttons.yaml?raw';

const url = z.string().url({ message: 'href must be an absolute URL' });

const buttonSchema = z.object({
  name: z.string(),
  href: url.optional(),
  // Zod v4 ignores v3's `required_error`/`invalid_type_error` without warning.
  // The `error` callback replaces them; `issue.input` tells missing from
  // wrong-type.
  img: z
    .string({
      error: (issue) =>
        issue.input === undefined
          ? 'img is required for every button'
          : 'img must be a string path',
    })
    .min(1, { message: 'img cannot be empty' }),
  alt: z.string().optional(),
  own: z.boolean().default(false),
});

const buttonsSchema = z.object({
  buttons: z.array(buttonSchema).default([]),
});

export type ButtonLink = z.infer<typeof buttonSchema>;
export type SiteButtons = z.infer<typeof buttonsSchema>;

export function parseButtons(source: string): SiteButtons {
  return buttonsSchema.parse(yaml.load(source) ?? {});
}

export function assertSingleOwnButton(buttons: ButtonLink[]): void {
  const own = buttons.filter((b) => b.own);
  if (own.length !== 1) {
    throw new Error(
      `buttons.yaml must mark exactly one button with \`own: true\` (found ${own.length}). ` +
        "That button is the site's own 88x31; the rest are other people's.",
    );
  }
}

export function loadButtons(): SiteButtons {
  const data = parseButtons(buttonsSource);
  assertSingleOwnButton(data.buttons);
  return data;
}
