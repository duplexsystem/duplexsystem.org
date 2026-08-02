import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs', 'rehype/**/*.test.mjs'],
    environment: 'node',
  },
});
