import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
    site: 'https://vault.egorthinks.com',
    // Every response goes through src/middleware.ts, which is where the session
    // check and the Content Security Policy live. Static pages would skip it.
    output: 'server',
    adapter: vercel(),
    devToolbar: { enabled: false },
    // No inline <style> or <script> anywhere, so the CSP can say 'self' and mean it.
    build: { inlineStylesheets: 'never' },
    vite: {
        plugins: [tailwindcss()],
        build: { assetsInlineLimit: 0 }
    }
});
