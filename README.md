# duplexsystem.org

Source for my personal site.

## Running

```sh
npm install
npm run dev
npm run build          # prebuild generators, astro build, Pagefind, postprocess and its gates
npm run preview:build  # build with drafts into dist-preview/
npm run serve          # serve dist/ (scripts/serve.mjs)
npm run verify:embeds  # build with drafts and check the embeds the kitchen-sink post carries
npm run fonts:lock     # refresh src/assets/fonts/chars.json, each font's characters
npx vitest run
python3 scripts/test_subset_fonts.py
```

## License

The code is [AGPL-3.0-or-later](LICENSE). The writing and images (posts,
pages and the site's own art) are [CC BY-SA 4.0](LICENSE-CONTENT), and the
code snippets in posts are [MIT-0](LICENSE-SNIPPETS); code a post quotes from
elsewhere keeps its own license. Font and third-party licenses are listed at
`/licenses/` and served from `public/licenses/`.
