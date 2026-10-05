/**
 * Chats, and how they are made destroyable.
 *
 * Notes live in git, which forgets nothing, so a deleted note stays readable in
 * history to anyone with the master password. Chats must be able to die for
 * real, so each one has its own random key, and that key lives outside git:
 *
 *   Vercel Blob   chatkeys/<id>.<expiry>.<wrapped key>     the only copy of the chat's key
 *   git           chats/<id>.enc                           messages, sealed with the chat key
 *   git           manifest.enc -> chats[id]                title and dates, sealed with the chat key
 *
 * Deleting the Blob object is the deletion. What git keeps afterwards is noise,
 * to everyone including the owner. Burning every chat at once is deleting every
 * chatkeys/ object.
 *
 * The chat key is wrapped with the vault key before it leaves the browser, and
 * the whole wrapped key is written into the object's *name*: one `list` call
 * returns every key, no object is ever overwritten (so no stale CDN copy), and
 * there is no read-modify-write for two devices to race on. The expiry is in
 * the name in plain digits so that the server, which can read nothing else,
 * can delete expired keys on its own.
 */
import { open, openJson, randomBytes, seal, sealJson, toBase64, fromBase64, type Bytes } from './crypto.ts';
import { decodeFile, encodeFile, ID_RE, PATHS } from './model.ts';

/** Per message. Each photo is re-sent with every later turn, so more would be slow and costly. */
export const MAX_CHAT_IMAGES = 4;

export const CHAT_KEY_PREFIX = 'chatkeys/';
const NAME_RE = /^chatkeys\/([0-9a-f]{32})\.(never|\d{1,12})\.([A-Za-z0-9_-]{60,200})$/;

export type ChatKeyRecord = { id: string; expires: number | null; wrapped: string };

export type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
    at: string;
    /** For assistant replies: which model answered, and what it cost if OpenRouter said. */
    model?: string;
    usage?: { prompt: number; completion: number; cost?: number };
    error?: string;
    /** Photos sent with a user message: ids of chats/<chat>/<image>.enc. */
    images?: string[];
};

export type Chat = { v: 1; id: string; messages: ChatMessage[] };

export type ChatMeta = { title: string; model: string; created: string; updated: string };

export const chatPath = PATHS.chat;
const metaPath = (id: string) => `chatmeta/${id}`;
const keyPath = (id: string) => `chatkey/${id}`;

/* Object names ------------------------------------------------------------ */

export function toBase64Url(bytes: Bytes): string {
    return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Bytes {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    return fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/** Expiry is whole seconds since the epoch, or null for "keep". */
export function chatKeyName(record: ChatKeyRecord): string {
    if (!ID_RE.test(record.id)) throw new Error('Bad chat id');
    if (record.expires !== null && (!Number.isInteger(record.expires) || record.expires < 0)) throw new Error('Bad expiry');
    const name = `${CHAT_KEY_PREFIX}${record.id}.${record.expires ?? 'never'}.${record.wrapped}`;
    if (!NAME_RE.test(name)) throw new Error('Bad wrapped key');
    return name;
}

export function parseChatKeyName(name: string): ChatKeyRecord | null {
    const m = NAME_RE.exec(name);
    if (!m) return null;
    return { id: m[1], expires: m[2] === 'never' ? null : Number(m[2]), wrapped: m[3] };
}

export function isExpired(record: { expires: number | null }, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
    return record.expires !== null && record.expires <= nowSeconds;
}

/* Keys -------------------------------------------------------------------- */

/**
 * A fresh chat key: the usable (non-extractable) key, and its wrapped form for
 * Blob. The raw bytes exist only for the length of this function.
 */
export async function newChatKey(vaultKey: CryptoKey, id: string): Promise<{ key: CryptoKey; wrapped: string }> {
    const raw = randomBytes(32);
    try {
        const wrapped = toBase64Url(await seal(vaultKey, keyPath(id), raw));
        const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        return { key, wrapped };
    } finally {
        raw.fill(0);
    }
}

export async function unwrapChatKey(vaultKey: CryptoKey, id: string, wrapped: string): Promise<CryptoKey> {
    const raw = await open(vaultKey, keyPath(id), fromBase64Url(wrapped));
    try {
        return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    } finally {
        raw.fill(0);
    }
}

/* Sealed contents --------------------------------------------------------- */

export async function sealChatMeta(key: CryptoKey, id: string, meta: ChatMeta): Promise<string> {
    return toBase64(await sealJson(key, metaPath(id), meta));
}

export async function openChatMeta(key: CryptoKey, id: string, sealed: string): Promise<ChatMeta> {
    return openJson<ChatMeta>(key, metaPath(id), fromBase64(sealed));
}

export async function sealChat(key: CryptoKey, chat: Chat): Promise<Bytes> {
    return sealJson(key, chatPath(chat.id), chat);
}

export async function openChat(key: CryptoKey, id: string, sealed: Bytes): Promise<Chat> {
    return openJson<Chat>(key, chatPath(id), sealed);
}

/** The first line of the first message, as a title. No model is asked: that would be one more request carrying the text. */
export function titleFrom(text: string): string {
    const line = text.trim().split('\n')[0].replace(/\s+/g, ' ');
    return line.length > 60 ? line.slice(0, 59).trimEnd() + '…' : line || 'New chat';
}

/**
 * A photo in a chat: sealed with the chat's key, at a path inside the chat, so
 * burning the chat's key burns its photos too.
 */
export async function sealChatImage(key: CryptoKey, chatId: string, imageId: string, type: string, bytes: Bytes): Promise<Bytes> {
    return seal(key, PATHS.chatImage(chatId, imageId), encodeFile(type, '', bytes));
}

export async function openChatImage(key: CryptoKey, chatId: string, imageId: string, sealed: Bytes): Promise<{ type: string; bytes: Bytes }> {
    const { type, bytes } = decodeFile(await open(key, PATHS.chatImage(chatId, imageId), sealed));
    return { type, bytes };
}
