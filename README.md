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

## Vault

`vault/` is a separate app: a private, end-to-end encrypted notebook served at `vault.egorthinks.com` from its own Vercel project. It shares this site's
design system through `src/styles/design-system.css`, which is why that file must not import packages by name. See [`vault/README.md`](vault/README.md).

## License

Theme code is GPL-3.0 (see `LICENSE`). Original content (posts, configuration values, custom components) is © Egor Fedorov.
