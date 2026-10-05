/**
 * The unlocked vault in memory: the key, the decrypted manifest, and what the
 * browser knows of the repository (head commit, path -> blob sha).
 *
 * Every write is a transaction: a function that edits a copy of the manifest
 * and names the files to put or delete. It is sealed and committed on top of
 * the head this browser last saw. If another device committed in between, the
 * commit is refused, the browser re-reads the repository, and the same
 * function runs again against the fresh manifest. Two devices editing
 * different notes therefore never lose anything; the same note edited in two
 * places at once keeps the later save, and the earlier one stays in git history.
 */
import * as api from './api.ts';
import { open, openJson, randomId, seal, sealJson, type Bytes, type VaultHeader } from '../lib/crypto.ts';
import { CHUNK_BYTES, chunkCount, MAX_DOC_BYTES, openDocChunk, safeFileName, sealDocChunk, verifyDoc } from '../lib/docs.ts';
import { decodeFile, emptyManifest, encodeFile, metaOf, PATHS, type DocMeta, type Manifest, type Note } from '../lib/model.ts';

type Put = { path: string; bytes: Bytes };
type Edit = { puts?: Put[]; deletes?: string[] };

const MAX_ATTEMPTS = 4;

/** The sha git will give these bytes, so the browser can track the tree without re-listing it. */
async function gitBlobSha(bytes: Bytes): Promise<string> {
    const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const all = new Uint8Array(head.length + bytes.length);
    all.set(head);
    all.set(bytes, head.length);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Vault {
    header: VaultHeader;
    manifest: Manifest = emptyManifest();
    private key: CryptoKey;
    private head: string | null;
    private files: api.Tree;
    private notes = new Map<string, { sha: string; note: Note }>();
    private images = new Map<string, string>();
    private queue: Promise<unknown> = Promise.resolve();

    constructor(key: CryptoKey, header: VaultHeader, state: api.State) {
        this.key = key;
        this.header = header;
        this.head = state.commit;
        this.files = state.files;
    }

    /** Read the manifest for a vault that exists. */
    async load(): Promise<void> {
        const entry = this.files[PATHS.manifest];
        if (!entry) {
            this.manifest = emptyManifest();
            return;
        }
        // A manifest written before documents existed has no `docs`.
        const m = await openJson<Partial<Manifest>>(this.key, PATHS.manifest, await api.blob(entry.sha));
        this.manifest = { v: 1, notes: m.notes ?? {}, files: m.files ?? {}, docs: m.docs ?? {} };
    }

    /**
     * Pick up commits made elsewhere. Returns the ids of notes whose content
     * changed, so an open editor can decide whether to reload.
     */
    async refresh(): Promise<string[]> {
        const state = await api.state();
        if (state.commit === this.head) return [];
        const before = this.files;
        this.head = state.commit;
        this.files = state.files;
        if (before[PATHS.manifest]?.sha !== state.files[PATHS.manifest]?.sha) await this.load();
        const changed: string[] = [];
        for (const [id, cached] of this.notes) {
            if (state.files[PATHS.note(id)]?.sha !== cached.sha) {
                this.notes.delete(id);
                changed.push(id);
            }
        }
        return changed;
    }

    /** One transaction at a time, so a pasted image and an autosave never race each other. */
    private transact(edit: (draft: Manifest) => Promise<Edit>): Promise<void> {
        const run = this.queue.then(() => this.transactNow(edit));
        this.queue = run.catch(() => {});
        return run;
    }

    private async transactNow(edit: (draft: Manifest) => Promise<Edit>): Promise<void> {
        for (let attempt = 0; ; attempt++) {
            const draft = structuredClone(this.manifest);
            const { puts = [], deletes = [] } = await edit(draft);
            const all = [...puts, { path: PATHS.manifest, bytes: await sealJson(this.key, PATHS.manifest, draft) }];
            try {
                this.head = await api.commit(this.head, [...all, ...deletes.map((path) => ({ path, bytes: null }))]);
            } catch (err) {
                if (err instanceof api.ConflictError && attempt < MAX_ATTEMPTS) {
                    await this.refresh();
                    continue;
                }
                throw err;
            }
            for (const p of all) this.files[p.path] = { sha: await gitBlobSha(p.bytes), size: p.bytes.length };
            for (const path of deletes) delete this.files[path];
            this.manifest = draft;
            return;
        }
    }

    /** First save of a brand-new vault: the header and an empty manifest in one commit. */
    async initialize(): Promise<void> {
        const headerBytes = new TextEncoder().encode(JSON.stringify(this.header, null, 2) + '\n');
        await this.transact(async () => {
            // Two tabs creating at once: the second must not replace the first's key.
            if (this.files[PATHS.header]) throw new Error('A vault already exists here. Reload and unlock it.');
            return { puts: [{ path: PATHS.header, bytes: headerBytes }] };
        });
    }

    async saveHeader(header: VaultHeader): Promise<void> {
        const bytes = new TextEncoder().encode(JSON.stringify(header, null, 2) + '\n');
        await this.transact(async () => ({ puts: [{ path: PATHS.header, bytes }] }));
        this.header = header;
    }

    /* Notes --------------------------------------------------------------- */

    listNotes(): { id: string; title: string; excerpt: string; updated: string }[] {
        return Object.entries(this.manifest.notes)
            .map(([id, m]) => ({ id, title: m.title, excerpt: m.excerpt, updated: m.updated }))
            .sort((a, b) => b.updated.localeCompare(a.updated));
    }

    async readNote(id: string): Promise<Note> {
        const entry = this.files[PATHS.note(id)];
        if (!entry) throw new Error('This note is not in the vault any more');
        const cached = this.notes.get(id);
        if (cached?.sha === entry.sha) return structuredClone(cached.note);
        const note = await openJson<Note>(this.key, PATHS.note(id), await api.blob(entry.sha));
        this.notes.set(id, { sha: entry.sha, note });
        return structuredClone(note);
    }

    async saveNote(note: Note): Promise<void> {
        const path = PATHS.note(note.id);
        let saved: Note = note;
        await this.transact(async (draft) => {
            // Attachments belong to the note that added them, wherever the manifest says.
            const files = Object.keys(draft.files).filter((f) => draft.files[f].note === note.id);
            saved = { ...note, files };
            draft.notes[note.id] = metaOf(saved);
            return { puts: [{ path, bytes: await sealJson(this.key, path, saved) }] };
        });
        this.notes.set(note.id, { sha: this.files[path].sha, note: structuredClone(saved) });
    }

    async deleteNote(id: string): Promise<void> {
        await this.transact(async (draft) => {
            const files = Object.keys(draft.files).filter((f) => draft.files[f].note === id);
            delete draft.notes[id];
            for (const f of files) delete draft.files[f];
            const deletes = [PATHS.note(id), ...files.map(PATHS.file)].filter((p) => this.files[p]);
            return { deletes };
        });
        this.notes.delete(id);
    }

    /* Attachments ---------------------------------------------------------- */

    async addFile(noteId: string, id: string, type: string, name: string, bytes: Bytes): Promise<void> {
        const path = PATHS.file(id);
        const sealed = await seal(this.key, path, encodeFile(type, name, bytes));
        await this.transact(async (draft) => {
            draft.files[id] = { type, size: bytes.length, note: noteId };
            return { puts: [{ path, bytes: sealed }] };
        });
        this.images.set(id, URL.createObjectURL(new Blob([bytes as BlobPart], { type })));
    }

    /** A blob: URL for a decrypted attachment, made once and kept while the vault is open. */
    async imageUrl(id: string): Promise<string | null> {
        const known = this.images.get(id);
        if (known) return known;
        const entry = this.files[PATHS.file(id)];
        if (!entry) return null;
        const file = decodeFile(await open(this.key, PATHS.file(id), await api.blob(entry.sha)));
        const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.type }));
        this.images.set(id, url);
        return url;
    }

    /* Documents ------------------------------------------------------------ */

    listDocs(): ({ id: string } & DocMeta)[] {
        return Object.entries(this.manifest.docs)
            .map(([id, m]) => ({ id, ...m }))
            .sort((a, b) => b.added.localeCompare(a.added));
    }

    /**
     * Seal and commit a document piece by piece: memory stays at one piece, and
     * each commit fits a request. The index entry goes in with the last piece, so
     * a document that fails halfway never appears in the list, and the pieces
     * already committed are taken back out.
     */
    async addDoc(file: File, onProgress?: (done: number, total: number) => void): Promise<string> {
        const name = safeFileName(file.name);
        if (file.size > MAX_DOC_BYTES) throw new Error(`Over ${MAX_DOC_BYTES / 1024 / 1024} MB, the most one document may be.`);
        const id = randomId();
        const meta: DocMeta = {
            name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            added: new Date().toISOString(),
            chunks: chunkCount(file.size)
        };
        const committed: string[] = [];
        try {
            for (let i = 0; i < meta.chunks; i++) {
                const data = new Uint8Array(await file.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).arrayBuffer());
                const bytes = await sealDocChunk(this.key, id, i, data, i === 0 ? meta : undefined);
                const last = i === meta.chunks - 1;
                await this.transact(async (draft) => {
                    if (last) draft.docs[id] = meta;
                    return { puts: [{ path: PATHS.doc(id, i), bytes }] };
                });
                committed.push(PATHS.doc(id, i));
                onProgress?.(i + 1, meta.chunks);
            }
        } catch (err) {
            if (committed.length) await this.transact(async () => ({ deletes: committed })).catch(() => {});
            throw err;
        }
        return id;
    }

    /** Fetch, decrypt and check every piece. The caller turns the result into a download. */
    async readDoc(id: string, onProgress?: (done: number, total: number) => void): Promise<{ meta: DocMeta; blob: Blob }> {
        const meta = this.manifest.docs[id];
        if (!meta) throw new Error('This document is not in the vault any more');
        const parts: Bytes[] = new Array(meta.chunks);
        let header: DocMeta | undefined;
        let done = 0;

        const pending = Array.from({ length: meta.chunks }, (_, i) => i);
        const worker = async () => {
            for (let i = pending.shift(); i !== undefined; i = pending.shift()) {
                const entry = this.files[PATHS.doc(id, i)];
                if (!entry) throw new Error('A piece of this document is missing from the repository');
                const piece = await openDocChunk(this.key, id, i, await api.blob(entry.sha));
                parts[i] = piece.data;
                if (i === 0) header = piece.header;
                onProgress?.(++done, meta.chunks);
            }
        };
        // Four pieces in flight at a time: fast enough, and gentle on the function.
        await Promise.all(Array.from({ length: Math.min(4, meta.chunks) }, worker));

        verifyDoc(id, header!, parts, meta);
        // octet-stream: a document is saved, never rendered by this page.
        return { meta, blob: new Blob(parts as BlobPart[], { type: 'application/octet-stream' }) };
    }

    async deleteDoc(id: string): Promise<void> {
        await this.transact(async (draft) => {
            const meta = draft.docs[id];
            delete draft.docs[id];
            const count = meta?.chunks ?? 0;
            const deletes = Array.from({ length: count }, (_, i) => PATHS.doc(id, i)).filter((p) => this.files[p]);
            return { deletes };
        });
    }
}
