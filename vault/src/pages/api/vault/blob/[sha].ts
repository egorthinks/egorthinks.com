import type { APIRoute } from 'astro';
import { SHA_RE } from '../../../../lib/model.ts';
import { crash, fail } from '../../../../server/http.ts';
import { storage } from '../../../../server/storage.ts';

/**
 * One blob by git sha. A sha names its content, so the browser keeps it for good
 * (privately: it is ciphertext, but still nobody else's business).
 */
export const GET: APIRoute = async ({ params }) => {
    const sha = params.sha ?? '';
    if (!SHA_RE.test(sha)) return fail(400, 'Not a blob id');
    try {
        const bytes = await storage().readBlob(sha);
        if (!bytes) return fail(404, 'No such blob');
        return new Response(bytes, {
            headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' }
        });
    } catch (err) {
        return crash('blob', err);
    }
};
