/**
 * Every response from the vault passes through here.
 *
 * - API writes must come from the vault's own origin (CSRF, on top of SameSite=Strict).
 * - /api/vault/* needs a signed-in session.
 * - Pages get a strict Content Security Policy: scripts only from this origin
 *   (plus WebAssembly, which Argon2 needs), connections only to this origin,
 *   images only from this origin or decrypted blob: URLs. The CSP is the
 *   backstop for the one weakness of encrypting in a web page: if hostile script
 *   ever ran here, it could read the password as it is typed. The only
 *   connection allowed outside this origin is to OpenRouter, for the AI chat.
 */
import { defineMiddleware } from 'astro:middleware';
import { origin } from './server/config.ts';
import { fail } from './server/http.ts';
import { readSession } from './server/session.ts';

const dev = import.meta.env.DEV;

const CSP = [
    "default-src 'none'",
    // Vite's dev client injects inline styles and scripts; production has none.
    `script-src 'self' 'wasm-unsafe-eval'${dev ? " 'unsafe-inline'" : ''}`,
    `style-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // OpenRouter is the one outside address: the browser talks to it directly, so prompts never pass through this server.
    `connect-src 'self' https://openrouter.ai${dev ? ' ws: wss:' : ''}`,
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests'])
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'X-Robots-Tag': 'noindex, nofollow'
};
if (!dev) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';

export const onRequest = defineMiddleware(async (context, next) => {
    const { request, url, cookies } = context;
    const isApi = url.pathname.startsWith('/api/');

    let response: Response;
    if (isApi && request.method !== 'GET' && request.method !== 'HEAD' && request.headers.get('origin') !== origin(url)) {
        response = fail(403, 'Cross-origin request refused');
    } else if (url.pathname.startsWith('/api/vault/') && !readSession(cookies)) {
        response = fail(401, 'Sign in first');
    } else {
        context.locals.session = readSession(cookies);
        response = await next();
    }

    // Mutated in place, not rebuilt: Astro attaches Set-Cookie to this exact Response object.
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
    if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'no-store');
    return response;
});
