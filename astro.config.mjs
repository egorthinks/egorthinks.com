import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import siteConfig from './src/data/site-config';
import { codeFrameTransformer } from './src/utils/shiki-code-frame.mjs';

/**
 * Monochrome syntax highlighting.
 *
 * The site has one palette and no accent colour, so code cannot be the one
 * place that sprouts six hues. Structure is carried the same way it is
 * everywhere else here: ink level and weight. Comments recede, keywords take
 * weight, punctuation drops back, strings sit between.
 *
 * Two themes rather than one because the whole palette inverts in the dark;
 * Shiki bakes colours into inline styles, so the dark variant rides along in
 * --shiki-dark custom properties and global.css swaps to them.
 */
const pencilTheme = (name, ink) => ({
    name,
    type: name === 'pencil-dark' ? 'dark' : 'light',
    colors: { 'editor.foreground': ink[100], 'editor.background': ink.bg },
    settings: [
        { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: ink[45], fontStyle: 'italic' } },
        { scope: ['punctuation', 'meta.brace', 'meta.delimiter'], settings: { foreground: ink[45] } },
        { scope: ['string', 'constant.other.symbol', 'string.quoted'], settings: { foreground: ink[70] } },
        { scope: ['constant.numeric', 'constant.language', 'constant.character'], settings: { foreground: ink[70] } },
        { scope: ['keyword', 'storage', 'storage.type', 'keyword.control', 'keyword.operator'], settings: { foreground: ink[100], fontStyle: 'bold' } },
        { scope: ['entity.name.function', 'support.function', 'entity.name.tag'], settings: { foreground: ink[100] } },
        { scope: ['variable', 'support.type.property-name', 'entity.other.attribute-name', 'meta.object-literal.key'], settings: { foreground: ink[85] } },
        { scope: ['entity.name.type', 'support.class', 'support.type'], settings: { foreground: ink[100] } }
    ]
});

const LIGHT_INK = { 100: '#171717', 85: '#333332', 70: '#5c5c5b', 45: '#8f8e8a', bg: '#f2f1ec' };
const DARK_INK = { 100: '#f2f1ec', 85: '#d6d5cf', 70: '#a8a7a1', 45: '#77766f', bg: '#171717' };

// https://astro.build/config
export default defineConfig({
    site: siteConfig.website,
    trailingSlash: 'always',
    markdown: {
        shikiConfig: {
            themes: {
                light: pencilTheme('pencil-light', LIGHT_INK),
                dark: pencilTheme('pencil-dark', DARK_INK)
            },
            wrap: false,
            transformers: [codeFrameTransformer()]
        }
    },
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
