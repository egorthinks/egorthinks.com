import type { APIRoute } from 'astro';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { origin, rpID } from '../../../server/config.ts';
import { fail, json, readJson } from '../../../server/http.ts';
import { verifyRegistration } from '../../../server/passkeys.ts';
import { startSession, takeChallenge } from '../../../server/session.ts';

export const POST: APIRoute = async ({ request, url, cookies }) => {
    // The challenge cookie is only ever issued after the session or setup-token check.
    const challenge = takeChallenge(cookies, 'register');
    if (!challenge) return fail(400, 'Registration expired, start again');
    const body = await readJson<{ response: RegistrationResponseJSON; name?: string }>(request);
    if (!body?.response) return fail(400, 'Malformed request');
    try {
        const id = await verifyRegistration(body.response, challenge, origin(url), rpID(url), body.name ?? '');
        startSession(cookies, id);
        return json({ ok: true });
    } catch (err) {
        console.error('[vault] register:', err);
        return fail(400, 'Passkey could not be verified');
    }
};
