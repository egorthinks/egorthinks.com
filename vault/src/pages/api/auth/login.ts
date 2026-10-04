import type { APIRoute } from 'astro';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { origin, rpID } from '../../../server/config.ts';
import { fail, json, readJson } from '../../../server/http.ts';
import { verifyAuthentication } from '../../../server/passkeys.ts';
import { startSession, takeChallenge } from '../../../server/session.ts';

export const POST: APIRoute = async ({ request, url, cookies }) => {
    const challenge = takeChallenge(cookies, 'login');
    if (!challenge) return fail(400, 'Sign-in expired, try again');
    const body = await readJson<{ response: AuthenticationResponseJSON }>(request);
    if (!body?.response) return fail(400, 'Malformed request');
    try {
        const id = await verifyAuthentication(body.response, challenge, origin(url), rpID(url));
        startSession(cookies, id);
        return json({ ok: true });
    } catch (err) {
        console.error('[vault] login:', err);
        return fail(401, 'Passkey was not accepted');
    }
};
