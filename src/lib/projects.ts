import yaml from 'js-yaml';
import { z } from 'astro/zod';
// ?raw, not node:fs: Astro stages SSR chunks without their sibling data files.
import source from '../data/projects.yaml?raw';

const projectSchema = z.object({
  name: z.string().min(1),
  href: z.string().url({ message: 'href must be an absolute URL' }),
  note: z.string().optional(),
});

const projectsSchema = z.object({
  projects: z.array(projectSchema).default([]),
});

export type Project = z.infer<typeof projectSchema>;

export function parseProjects(src: string): Project[] {
  return projectsSchema.parse(yaml.load(src) ?? {}).projects;
}

export function loadProjects(): Project[] {
  return parseProjects(source);
}
