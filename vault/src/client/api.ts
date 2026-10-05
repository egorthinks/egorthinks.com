/** The server, as the browser sees it. Everything sent through here is already ciphertext. */
import type { Bytes } from '../lib/crypto.ts';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

export type Tree = Record<string, { sha: string; size: number }>;
export type State = { commit: string | null; files: Tree };

/** The session is gone (expired, or signed out elsewhere). Only the vault endpoints raise it. */
export class AuthError extends Error {
    constructor() {
        super('Signed out');
        this.name = 'AuthError';
    }
}

export class ConflictError extends Error {
    constructor() {
        super('The vault changed elsewhere');
        this.name = 'ConflictError';
    }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(path, { credentials: 'same-origin', ...init });
    // A 401 from the sign-in endpoints is a refusal with its own message, not a lost session.
    if (res.status === 401 && path.startsWith('/api/vault/')) throw new AuthError();
    if (res.status === 409) throw new ConflictError();
    if (!res.ok) {
        let message = `${res.status}`;
        try {
            message = ((await res.json()) as { error?: string }).error ?? message;
        } catch {}
        throw new Error(message);
    }
    return res;
}

const post = (path: string, body?: unknown) =>
    call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

export async function status(): Promise<{ signedIn: boolean; hasPasskeys: boolean }> {
    return (await call('/api/auth/status')).json();
}

export async function loginOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return (await post('/api/auth/login-options')).json();
}

export async function login(response: unknown): Promise<void> {
    await post('/api/auth/login', { response });
}

export async function registerOptions(setupToken?: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return (await post('/api/auth/register-options', setupToken ? { setupToken } : {})).json();
}

export async function register(response: unknown, name: string): Promise<void> {
    await post('/api/auth/register', { response, name });
}

export async function logout(): Promise<void> {
    await post('/api/auth/logout');
}

export async function state(): Promise<State> {
    return (await call('/api/vault/state', { cache: 'no-store' })).json();
}

export async function blob(sha: string): Promise<Bytes> {
    // Content-addressed and cached by the browser for good: re-opening a note costs nothing.
    return new Uint8Array(await (await call(`/api/vault/blob/${sha}`)).arrayBuffer());
}

/** Atomic: every change lands on top of `parent`, or ConflictError and nothing does. */
export async function commit(parent: string | null, changes: { path: string; bytes: Bytes | null }[]): Promise<string> {
    const head = new TextEncoder().encode(JSON.stringify({ parent, changes: changes.map((c) => ({ path: c.path, size: c.bytes ? c.bytes.length : null })) }));
    const total = 4 + head.length + changes.reduce((n, c) => n + (c.bytes?.length ?? 0), 0);
    const body = new Uint8Array(total);
    new DataView(body.buffer).setUint32(0, head.length);
    body.set(head, 4);
    let offset = 4 + head.length;
    for (const c of changes) {
        if (!c.bytes) continue;
        body.set(c.bytes, offset);
        offset += c.bytes.length;
    }
    const res = await call('/api/vault/commit', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
    return ((await res.json()) as { commit: string }).commit;
}

/* Chat keys: the destroyable half of every chat (see lib/chat.ts) */

export type ChatKeyRecord = { id: string; expires: number | null; wrapped: string };

export async function chatKeys(): Promise<ChatKeyRecord[]> {
    return ((await (await call('/api/vault/chatkeys', { cache: 'no-store' })).json()) as { keys: ChatKeyRecord[] }).keys;
}

export async function putChatKey(record: ChatKeyRecord): Promise<void> {
    await post('/api/vault/chatkeys', record);
}

export async function deleteChatKey(id: string): Promise<void> {
    // A content type keeps Astro's form-CSRF check out of the way; the middleware's own Origin check still applies.
    await call(`/api/vault/chatkeys/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
}

export async function burnChatKeys(): Promise<number> {
    return ((await (await post('/api/vault/chatkeys', { burn: true })).json()) as { burned: number }).burned;
}
