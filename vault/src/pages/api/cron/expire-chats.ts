import type { APIRoute } from 'astro';
import { env } from '../../../server/config.ts';
import { expireChatKeys } from '../../../server/chatkeys.ts';
import { crash, fail, json } from '../../../server/http.ts';
import { safeEqual } from '../../../server/session.ts';

/**
 * Daily (see vercel.json). Deletes chat keys past their expiry, so a chat set
 * to disappear does, even if the vault is never opened again. Vercel calls it
 * with `Authorization: Bearer $CRON_SECRET`; nobody else can.
 */
export const GET: APIRoute = async ({ request }) => {
    const secret = env('CRON_SECRET');
    const given = request.headers.get('authorization') ?? '';
    if (!secret || !safeEqual(given, `Bearer ${secret}`)) return fail(401, 'Not the cron');
    try {
        return json({ expired: await expireChatKeys() });
    } catch (err) {
        return crash('cron expire', err);
    }
};
