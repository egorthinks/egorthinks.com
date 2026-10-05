/**
 * Stored documents: pdf, xlsx, docx, anything. Added whole, downloaded whole,
 * never edited.
 *
 * A document is cut into pieces of CHUNK_BYTES, because one save has to fit in
 * a Vercel request (4.5 MB). Each piece is its own sealed object at
 * docs/<id>/<index>.enc, and its path is its associated data, so a piece cannot
 * be moved to another position or another document without failing to open.
 *
 * Piece 0 begins with a header (name, type, size, piece count), so a document
 * can be reassembled from the repository alone, with no manifest, and so a
 * missing or surplus piece is noticed: the count is inside authenticated data.
 *
 *   piece 0 plaintext:  u32 header length | JSON header | first bytes
 *   piece n plaintext:  next bytes
 *
 * Pure functions on WebCrypto, shared by the browser and the offline decryptor.
 */
import { CorruptObjectError, open, seal, type Bytes } from './crypto.ts';
import { PATHS, type DocMeta } from './model.ts';

/** Sealed, a piece stays under the 4 MiB the commit endpoint accepts. */
export const CHUNK_BYTES = 3 * 1024 * 1024;

/** Keeps the data repository healthy: git remembers every byte ever committed. */
export const MAX_DOC_BYTES = 50 * 1024 * 1024;

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder('utf-8', { fatal: true });

export function chunkCount(size: number): number {
    return Math.max(1, Math.ceil(size / CHUNK_BYTES));
}

/**
 * A name that is safe to show and to hand to the browser as a download name:
 * no directories, no control characters, no characters Windows refuses, no
 * leading dots. The extension survives shortening.
 */
export function safeFileName(name: string): string {
    const last = name.split(/[\\/]/).filter(Boolean).pop() ?? '';
    const clean = last
        .replace(/[\u0000-\u001f\u007f:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[.\s]+/, '')
        .trim();
    if (!clean) return 'file';
    if (clean.length <= 120) return clean;
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 && clean.length - dot <= 12 ? clean.slice(dot) : '';
    return clean.slice(0, 120 - ext.length).trimEnd() + ext;
}

/** Piece `index` of the document `id`. Piece 0 needs the header. */
export async function sealDocChunk(key: CryptoKey, id: string, index: number, data: Bytes, header?: DocMeta): Promise<Bytes> {
    if (index !== 0) return seal(key, PATHS.doc(id, index), data);
    if (!header) throw new Error('The first piece of a document carries its header');
    const head = utf8.encode(JSON.stringify(header));
    const plain = new Uint8Array(4 + head.length + data.length);
    new DataView(plain.buffer).setUint32(0, head.length);
    plain.set(head, 4);
    plain.set(data, 4 + head.length);
    return seal(key, PATHS.doc(id, index), plain);
}

export async function openDocChunk(key: CryptoKey, id: string, index: number, sealed: Bytes): Promise<{ header?: DocMeta; data: Bytes }> {
    const plain = await open(key, PATHS.doc(id, index), sealed);
    if (index !== 0) return { data: plain };
    if (plain.length < 4) throw new CorruptObjectError(`${PATHS.doc(id, 0)} has no header`);
    const len = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(0);
    if (4 + len > plain.length) throw new CorruptObjectError(`${PATHS.doc(id, 0)} has a damaged header`);
    const header = JSON.parse(fromUtf8.decode(plain.subarray(4, 4 + len))) as DocMeta;
    return { header, data: plain.subarray(4 + len) };
}

/**
 * Is this the whole document? `expected` comes from wherever the caller learned
 * of it (the manifest, or nothing at all offline); `header` is piece 0's own.
 */
export function verifyDoc(id: string, header: DocMeta, parts: Bytes[], expected?: DocMeta) {
    if (parts.length !== header.chunks) {
        throw new CorruptObjectError(`docs/${id} has ${parts.length} of ${header.chunks} pieces`);
    }
    const size = parts.reduce((n, p) => n + p.length, 0);
    if (size !== header.size) throw new CorruptObjectError(`docs/${id} is ${size} bytes, expected ${header.size}`);
    if (expected && (expected.size !== header.size || expected.chunks !== header.chunks)) {
        throw new CorruptObjectError(`docs/${id} does not match the index`);
    }
}

/** Everything at once, for callers that already hold every sealed piece in order. */
export async function openDoc(key: CryptoKey, id: string, sealed: Bytes[]): Promise<{ meta: DocMeta; parts: Bytes[] }> {
    const first = await openDocChunk(key, id, 0, sealed[0] ?? new Uint8Array(0));
    const parts: Bytes[] = [first.data];
    for (let i = 1; i < sealed.length; i++) parts.push((await openDocChunk(key, id, i, sealed[i])).data);
    verifyDoc(id, first.header!, parts);
    return { meta: first.header!, parts };
}

/** Splits and seals a whole document. The browser does this piece by piece instead, to keep memory flat. */
export async function sealDoc(key: CryptoKey, id: string, meta: DocMeta, bytes: Bytes): Promise<Bytes[]> {
    const out: Bytes[] = [];
    for (let i = 0; i < meta.chunks; i++) {
        out.push(await sealDocChunk(key, id, i, bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES), i === 0 ? meta : undefined));
    }
    return out;
}
