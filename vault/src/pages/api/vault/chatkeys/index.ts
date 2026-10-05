import type { APIRoute } from 'astro';
import { parseChatKeyName, chatKeyName, type ChatKeyRecord } from '../../../../lib/chat.ts';
import { burnChatKeys, listChatKeys, putChatKey } from '../../../../server/chatkeys.ts';
import { crash, fail, json, readJson } from '../../../../server/http.ts';

/** Every live chat key, still wrapped with the vault key. */
export const GET: APIRoute = async () => {
    try {
        return json({ keys: await listChatKeys() });
    } catch (err) {
        return crash('chatkeys list', err);
    }
};

/** Create a chat's key, or change its expiry. `{ burn: true }` destroys every key instead. */
export const POST: APIRoute = async ({ request }) => {
    const body = await readJson<Partial<ChatKeyRecord> & { burn?: boolean }>(request);
    if (!body) return fail(400, 'Malformed request');
    try {
        if (body.burn === true) return json({ burned: await burnChatKeys() });

        const record: ChatKeyRecord = { id: String(body.id), expires: body.expires ?? null, wrapped: String(body.wrapped) };
        // Round-trip through the name format: the same validation the listing applies.
        let name: string;
        try {
            name = chatKeyName(record);
        } catch {
            return fail(400, 'Bad chat key record');
        }
        const parsed = parseChatKeyName(name)!;
        const tenYears = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
        if (parsed.expires !== null && parsed.expires > tenYears) return fail(400, 'Expiry too far away');
        await putChatKey(parsed);
        return json({ ok: true });
    } catch (err) {
        return crash('chatkeys put', err);
    }
};
