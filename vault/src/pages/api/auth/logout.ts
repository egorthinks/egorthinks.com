import type { APIRoute } from 'astro';
import { json } from '../../../server/http.ts';
import { endSession } from '../../../server/session.ts';

export const POST: APIRoute = async ({ cookies }) => {
    endSession(cookies);
    return json({ ok: true });
};
