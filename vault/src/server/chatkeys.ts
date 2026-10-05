/**
 * Where chat keys live: the one store whose deletes are real. See lib/chat.ts.
 *
 * Production is Vercel Blob (BLOB_READ_WRITE_TOKEN comes with the store once it
 * is connected to the project). `VAULT_STORAGE=fs` keeps them as empty files in
 * a local folder for development and tests.
 *
 * The server never sees a usable key: the names it stores hold keys wrapped with
 * the vault key, which only the browser has. What it can read is the expiry,
 * which is the point: it deletes expired keys itself, on every listing and from
 * a daily cron, even if the owner never opens the vault again.
 */
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CHAT_KEY_PREFIX, chatKeyName, isExpired, parseChatKeyName, type ChatKeyRecord } from '../lib/chat.ts';
import { env } from './config.ts';

interface NameStore {
    names(): Promise<string[]>;
    create(name: string): Promise<void>;
    remove(names: string[]): Promise<void>;
}

class FsNames implements NameStore {
    private dir: string;
    constructor(dir: string) {
        this.dir = join(dir, 'chatkeys');
    }
    async names() {
        try {
            return (await readdir(this.dir)).map((f) => CHAT_KEY_PREFIX + f);
        } catch {
            return [];
        }
    }
    async create(name: string) {
        await mkdir(this.dir, { recursive: true });
        await writeFile(join(this.dir, name.slice(CHAT_KEY_PREFIX.length)), '');
    }
    async remove(names: string[]) {
        for (const n of names) await unlink(join(this.dir, n.slice(CHAT_KEY_PREFIX.length))).catch(() => {});
    }
}

class BlobNames implements NameStore {
    private token: string;
    /** Stores are created public or private; whichever this one is, remember it after the first write. */
    private access: 'private' | 'public' | null = null;
    private urls = new Map<string, string>();

    constructor(token: string) {
        this.token = token;
    }

    async names() {
        const { list } = await import('@vercel/blob');
        const out: string[] = [];
        let cursor: string | undefined;
        do {
            const page = await list({ prefix: CHAT_KEY_PREFIX, cursor, limit: 1000, token: this.token });
            for (const b of page.blobs) {
                out.push(b.pathname);
                this.urls.set(b.pathname, b.url);
            }
            cursor = page.hasMore ? page.cursor : undefined;
        } while (cursor);
        return out;
    }

    async create(name: string) {
        const { put } = await import('@vercel/blob');
        // The content is irrelevant: the name is the record. Cached for the minimum, so a deleted key's copy dies within a minute.
        const options = { addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60, contentType: 'application/octet-stream', token: this.token };
        for (const access of this.access ? [this.access] : (['private', 'public'] as const)) {
            try {
                const result = await put(name, '0', { ...options, access });
                this.access = access;
                this.urls.set(name, result.url);
                return;
            } catch (err) {
                if (this.access || access === 'public') throw err;
            }
        }
    }

    async remove(names: string[]) {
        if (!names.length) return;
        const { del } = await import('@vercel/blob');
        // Pathnames work for del; URLs are used when known, which also covers stores that need them.
        await del(
            names.map((n) => this.urls.get(n) ?? n),
            { token: this.token }
        );
        for (const n of names) this.urls.delete(n);
    }
}

let instance: NameStore | undefined;

function store(): NameStore {
    if (instance) return instance;
    if (env('VAULT_STORAGE') === 'fs') {
        if (process.env.VERCEL) throw new Error('VAULT_STORAGE=fs is for local development only');
        instance = new FsNames(env('VAULT_FS_DIR') || '.vault-data');
    } else {
        const token = env('BLOB_READ_WRITE_TOKEN');
        if (!token) throw new Error('Connect a Vercel Blob store to the project (BLOB_READ_WRITE_TOKEN is missing)');
        instance = new BlobNames(token);
    }
    return instance;
}

/** Every live chat key. Expired ones are deleted on the way, so a listing never returns one. */
export async function listChatKeys(): Promise<ChatKeyRecord[]> {
    const live: ChatKeyRecord[] = [];
    const dead: string[] = [];
    for (const name of await store().names()) {
        const record = parseChatKeyName(name);
        if (!record || isExpired(record)) dead.push(name);
        else live.push(record);
    }
    await store().remove(dead);
    return live;
}

/** Create, or replace (a new expiry is a new name; the old name goes). */
export async function putChatKey(record: ChatKeyRecord): Promise<void> {
    const name = chatKeyName(record);
    await store().create(name);
    const stale = (await store().names()).filter((n) => n !== name && n.startsWith(`${CHAT_KEY_PREFIX}${record.id}.`));
    await store().remove(stale);
}

export async function deleteChatKey(id: string): Promise<void> {
    await store().remove((await store().names()).filter((n) => n.startsWith(`${CHAT_KEY_PREFIX}${id}.`)));
}

/** Burn every chat at once. Returns how many keys were destroyed. */
export async function burnChatKeys(): Promise<number> {
    const names = await store().names();
    await store().remove(names);
    return names.length;
}

export async function expireChatKeys(): Promise<number> {
    const before = (await store().names()).length;
    const after = (await listChatKeys()).length;
    return before - after;
}
