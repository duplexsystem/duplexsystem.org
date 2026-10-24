import { load as loadYaml } from 'js-yaml';
import { z } from 'astro/zod';
import buttonsSource from '../data/buttons.yaml?raw';

const url = z.string().url({ message: 'href must be an absolute URL' });

const buttonSchema = z
  .object({
    name: z.string(),
    href: url.optional(),
    img: z
      .string({ error: () => 'img must be a string path' })
      .min(1, {
        message: 'img cannot be empty',
      })
      .optional(),
    text: z.string().min(1, { message: 'text cannot be empty' }).optional(),
    tile: z
      .object({
        background: z.string(),
        color: z.string(),
        border: z.string().optional(),
        font: z.string().optional(),
        underline: z.boolean().default(false),
      })
      .optional(),
    friend: z.boolean().default(false),
    alt: z.string().optional(),
    own: z.boolean().default(false),
  })
  .refine((b) => (b.img === undefined) !== (b.text === undefined), {
    message: 'img or text is required for every button, not both',
    path: ['img'],
  })
  .refine((b) => !b.own || b.img !== undefined, {
    message: 'the own button needs an img',
    path: ['img'],
  });

const buttonsSchema = z.object({
  buttons: z.array(buttonSchema).default([]),
});

export type ButtonLink = z.infer<typeof buttonSchema>;
export type SiteButtons = z.infer<typeof buttonsSchema>;

export function parseButtons(source: string): SiteButtons {
  return buttonsSchema.parse((source.trim() && loadYaml(source)) || {});
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
