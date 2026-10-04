import type { APIRoute } from 'astro';
import { parseHeader } from '../../../lib/crypto.ts';
import { CLIENT_PATH_RE, MAX_OBJECT_BYTES, PATHS } from '../../../lib/model.ts';
import { crash, fail, json } from '../../../server/http.ts';
import { storage, type Change } from '../../../server/storage.ts';

/**
 * One save: a set of paths and their new contents, committed atomically on top
 * of `parent` or not at all (409, and the client re-reads and retries).
 *
 * Body: u32 header length | JSON { parent, changes: [{ path, size | null }] } | contents, in order.
 * Binary rather than base64-in-JSON, because Vercel caps a request at 4.5 MB.
 *
 * The server checks that everything except vault.json is a sealed object. It
 * cannot tell good ciphertext from bad, but it can refuse plaintext, so a bug
 * in the client cannot quietly write a note to GitHub unencrypted.
 */
const MAGIC = [0x45, 0x47, 0x56, 0x31];
const MAX_CHANGES = 64;

export const POST: APIRoute = async ({ request }) => {
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.length > MAX_OBJECT_BYTES + 64 * 1024 || body.length < 4) return fail(413, 'Too large');

    const headLen = new DataView(body.buffer, body.byteOffset).getUint32(0);
    let head: { parent: string | null; changes: { path: string; size: number | null }[] };
    try {
        head = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + headLen)));
    } catch {
        return fail(400, 'Malformed request');
    }
    if (!Array.isArray(head.changes) || head.changes.length === 0 || head.changes.length > MAX_CHANGES) return fail(400, 'Bad change list');
    if (head.parent !== null && !/^[0-9a-f]{40}$/.test(String(head.parent))) return fail(400, 'Bad parent');

    const changes: Change[] = [];
    const seen = new Set<string>();
    let offset = 4 + headLen;
    for (const { path, size } of head.changes) {
        if (typeof path !== 'string' || !CLIENT_PATH_RE.test(path) || seen.has(path)) return fail(400, `Path not allowed: ${path}`);
        seen.add(path);
        if (size === null) {
            changes.push({ path, bytes: null });
            continue;
        }
        if (!Number.isInteger(size) || size < 0 || offset + size > body.length) return fail(400, 'Sizes do not add up');
        const bytes = body.subarray(offset, offset + size);
        offset += size;
        if (path === PATHS.header) {
            try {
                parseHeader(new TextDecoder().decode(bytes));
            } catch {
                return fail(400, 'vault.json is not a vault header');
            }
        } else if (!MAGIC.every((b, i) => bytes[i] === b)) {
            return fail(400, `${path} is not encrypted; refusing to store it`);
        }
        changes.push({ path, bytes });
    }
    if (offset !== body.length) return fail(400, 'Sizes do not add up');

    try {
        // Commit messages are plaintext on GitHub, so they say nothing about the content.
        const result = await storage().commit(head.parent, changes, 'Save');
        return 'conflict' in result ? fail(409, 'The vault changed since it was loaded') : json(result);
    } catch (err) {
        return crash('commit', err);
    }
};
