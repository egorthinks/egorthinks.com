import type { APIRoute } from 'astro';
import { crash, json } from '../../../server/http.ts';
import { listPasskeys } from '../../../server/passkeys.ts';

/** What the sign-in screen needs: is this browser signed in, and does any passkey exist yet. */
export const GET: APIRoute = async ({ locals }) => {
    try {
        const { credentials } = await listPasskeys();
        return json({ signedIn: Boolean(locals.session), hasPasskeys: credentials.length > 0 });
    } catch (err) {
        return crash('status', err);
    }
};
