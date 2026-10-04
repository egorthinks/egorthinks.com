/**
 * What lives in the data repository, and the shapes inside the ciphertext.
 *
 *   README.md              written once by the server: what this repo is
 *   vault.json             key slots (see crypto.ts); the only plaintext the client writes
 *   manifest.enc           { notes, files } index, so the list opens with one fetch
 *   notes/<id>.md.enc      one note: title + markdown body
 *   files/<id>.enc         one attachment: type + bytes
 *   .vault/passkeys.json   public keys of registered passkeys; server-only
 *
 * File names are random ids, so the tree says how many notes there are and
 * roughly how long, and nothing else. Every note also carries its own title,
 * so the manifest is an index that can be rebuilt, not the only copy.
 */
import type { Bytes } from './crypto.ts';

export const PATHS = {
    header: 'vault.json',
    manifest: 'manifest.enc',
    passkeys: '.vault/passkeys.json',
    note: (id: string) => `notes/${id}.md.enc`,
    file: (id: string) => `files/${id}.enc`
};

export const ID_RE = /^[0-9a-f]{32}$/;
export const SHA_RE = /^[0-9a-f]{40}$/;

/** Paths the browser may write. The passkey list is the server's alone. */
export const CLIENT_PATH_RE = /^(?:vault\.json|manifest\.enc|notes\/[0-9a-f]{32}\.md\.enc|files\/[0-9a-f]{32}\.enc)$/;

/** Vercel functions take 4.5 MB of body; leave room for headers. */
export const MAX_OBJECT_BYTES = 4 * 1024 * 1024;

export type NoteMeta = {
    title: string;
    /** First lines of the body, for the list and for search without opening every note. */
    excerpt: string;
    created: string;
    updated: string;
    /** Attachments ever added to this note; deleted with it. */
    files: string[];
};

export type FileMeta = { type: string; size: number; note: string };

export type Manifest = {
    v: 1;
    notes: Record<string, NoteMeta>;
    files: Record<string, FileMeta>;
};

export type Note = {
    v: 1;
    id: string;
    title: string;
    body: string;
    created: string;
    updated: string;
    files: string[];
};

export function emptyManifest(): Manifest {
    return { v: 1, notes: {}, files: {} };
}

export function excerptOf(body: string): string {
    return body
        .replace(/<[^>]*>/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/[#>*_`~[\]()-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
}

export function metaOf(note: Note): NoteMeta {
    return { title: note.title, excerpt: excerptOf(note.body), created: note.created, updated: note.updated, files: [...note.files] };
}

/* Attachments: 4-byte big-endian header length | JSON { type, name } | bytes */

const utf8 = new TextEncoder();

export function encodeFile(type: string, name: string, bytes: Bytes): Bytes {
    const head = utf8.encode(JSON.stringify({ type, name }));
    const out = new Uint8Array(4 + head.length + bytes.length);
    new DataView(out.buffer).setUint32(0, head.length);
    out.set(head, 4);
    out.set(bytes, 4 + head.length);
    return out;
}

export function decodeFile(plain: Bytes): { type: string; name: string; bytes: Bytes } {
    const len = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(0);
    const head = JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + len))) as { type: string; name: string };
    return { ...head, bytes: plain.subarray(4 + len) };
}

/** Image references in a note body: ![alt](vault:<id>) */
export const VAULT_IMAGE_RE = /vault:([0-9a-f]{32})/g;
