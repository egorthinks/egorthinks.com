import type { APIRoute } from 'astro';
import { crash, json } from '../../../server/http.ts';
import { storage } from '../../../server/storage.ts';

/** Head commit and the path -> blob sha listing. Carries no plaintext: names are random ids. */
export const GET: APIRoute = async () => {
    try {
        return json(await storage().state());
    } catch (err) {
        return crash('state', err);
    }
};
