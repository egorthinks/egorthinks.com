import type { APIRoute } from 'astro';
import { rpID } from '../../../server/config.ts';
import { crash, json } from '../../../server/http.ts';
import { authenticationOptions } from '../../../server/passkeys.ts';
import { setChallenge } from '../../../server/session.ts';

export const POST: APIRoute = async ({ url, cookies }) => {
    try {
        const options = await authenticationOptions(rpID(url));
        setChallenge(cookies, 'login', options.challenge);
        return json(options);
    } catch (err) {
        return crash('login-options', err);
    }
};
