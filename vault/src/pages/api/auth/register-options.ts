import type { APIRoute } from 'astro';
import { env, rpID } from '../../../server/config.ts';
import { crash, fail, json, readJson } from '../../../server/http.ts';
import { listPasskeys, registrationOptions } from '../../../server/passkeys.ts';
import { safeEqual, setChallenge } from '../../../server/session.ts';

function setupTokenMatches(given: unknown): boolean {
    const expected = env('VAULT_SETUP_TOKEN');
    return Boolean(expected) && typeof given === 'string' && safeEqual(expected!, given);
}

/**
 * A new passkey needs either a signed-in session (adding a device) or, while
 * no passkey exists at all, the setup token. Once one exists the token stops
 * working even if it is still set, so a leaked token cannot add a backdoor.
 */
export const POST: APIRoute = async ({ request, url, cookies, locals }) => {
    try {
        if (!locals.session) {
            const body = await readJson<{ setupToken?: string }>(request);
            const { credentials } = await listPasskeys();
            if (credentials.length > 0) return fail(401, 'Sign in with an existing passkey to add another');
            if (!setupTokenMatches(body?.setupToken)) return fail(401, 'Setup token is wrong or not configured');
        }
        const options = await registrationOptions(rpID(url));
        setChallenge(cookies, 'register', options.challenge);
        return json(options);
    } catch (err) {
        return crash('register-options', err);
    }
};
