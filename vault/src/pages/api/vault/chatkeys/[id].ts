import type { APIRoute } from 'astro';
import { ID_RE } from '../../../../lib/model.ts';
import { deleteChatKey } from '../../../../server/chatkeys.ts';
import { crash, fail, json } from '../../../../server/http.ts';

/** Destroys one chat: without its key, everything git holds of it is noise. */
export const DELETE: APIRoute = async ({ params }) => {
    if (!ID_RE.test(params.id ?? '')) return fail(400, 'Not a chat id');
    try {
        await deleteChatKey(params.id!);
        return json({ ok: true });
    } catch (err) {
        return crash('chatkeys delete', err);
    }
};
