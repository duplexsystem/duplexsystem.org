export function includeDrafts(value = process.env.INCLUDE_DRAFTS): boolean {
  return /^(1|true|yes)$/i.test(value?.trim() ?? '');
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const DRAFT = /^draft:\s*true\s*$/m;

export function frontmatterOf(text: string): string | null {
  return FRONTMATTER.exec(text)?.[1] ?? null;
}

export function isDraft(text: string): boolean {
  return DRAFT.test(frontmatterOf(text) ?? '');
}
