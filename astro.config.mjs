import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import siteConfig from './src/data/site-config';

// https://astro.build/config
export default defineConfig({
    site: siteConfig.website,
    trailingSlash: 'always',
    vite: {
        plugins: [tailwindcss()]
    },
    integrations: [
        mdx(),
        sitemap({
            serialize(item) {
                // Lower priority for paginated archive pages (e.g. /blog/2/)
                if (/\/blog\/\d+\/?$/.test(item.url)) {
                    item.priority = 0.4;
                } else if (item.url === siteConfig.website) {
                    item.priority = 1.0;
                } else if (/\/(research|faq)\/$/.test(item.url) || item.url.includes('/glossary/')) {
                    // Reference pages targeted at search and AI answer engines
                    item.priority = 0.9;
                }
                return item;
            }
        })
    ]
});
