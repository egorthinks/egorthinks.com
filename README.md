# egorthinks.com

Personal blog. Notes on cognition, focus, and code for developers working with AI.

Built with [Astro](https://astro.build).

## Local development

```bash
npm install
npm run dev
```

Dev server runs at `http://localhost:4321`.

## Build

```bash
npm run build
npm run preview
```

Output is written to `dist/`.

## Writing a post

Posts live in `src/content/blog/*.md` (or `.mdx`). Frontmatter schema is defined in `src/content.config.ts`. Minimum required fields:

```yaml
---
title: Post title
publishDate: 'Jan 1 2026'
---
```

Optional fields: `excerpt`, `updatedDate`, `isFeatured`, `tags`, `seo`.

## Deploy

Pushed to `main` → auto-deployed by Vercel.

## License

Theme code is GPL-3.0 (see `LICENSE`). Original content (posts, configuration values, custom components) is © Egor Fedorov.
