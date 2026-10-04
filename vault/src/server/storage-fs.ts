/**
 * Local stand-in for the GitHub repository, for `npm run dev` and the
 * end-to-end tests. Same contract, same blob shas as git would compute, no
 * network and no token. Refuses to run on Vercel (see storage.ts).
 */
import type { Bytes } from '../lib/crypto.ts';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Change, CommitResult, State, Storage, Tree } from './storage.ts';

type CommitObject = { parent: string | null; tree: Tree; message: string; time: string };

export class FsStorage implements Storage {
    private dir: string;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(dir: string) {
        this.dir = dir;
    }

    private async head(): Promise<string | null> {
        try {
            return (await readFile(join(this.dir, 'HEAD'), 'utf8')).trim() || null;
        } catch {
            return null;
        }
    }

    private async commitObject(id: string): Promise<CommitObject> {
        return JSON.parse(await readFile(join(this.dir, 'commits', `${id}.json`), 'utf8'));
    }

    async state(): Promise<State> {
        const commit = await this.head();
        return { commit, files: commit ? (await this.commitObject(commit)).tree : {} };
    }

    async readBlob(sha: string): Promise<Bytes | null> {
        try {
            return new Uint8Array(await readFile(join(this.dir, 'blobs', sha)));
        } catch {
            return null;
        }
    }

    private async writeBlob(bytes: Bytes): Promise<string> {
        const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        await mkdir(join(this.dir, 'blobs'), { recursive: true });
        await writeFile(join(this.dir, 'blobs', sha), bytes);
        return sha;
    }

    commit(parent: string | null, changes: Change[], message: string): Promise<CommitResult> {
        // One writer at a time, so check-then-write is atomic within this process.
        const run = this.queue.then(() => this.commitNow(parent, changes, message));
        this.queue = run.catch(() => {});
        return run;
    }

    private async commitNow(parent: string | null, changes: Change[], message: string): Promise<CommitResult> {
        if ((await this.head()) !== parent) return { conflict: true };
        const tree: Tree = parent ? { ...(await this.commitObject(parent)).tree } : {};
        for (const { path, bytes } of changes) {
            if (bytes === null) delete tree[path];
            else tree[path] = { sha: await this.writeBlob(bytes), size: bytes.length };
        }
        const obj: CommitObject = { parent, tree, message, time: new Date().toISOString() };
        const json = JSON.stringify(obj);
        const id = createHash('sha1').update(json).digest('hex');
        await mkdir(join(this.dir, 'commits'), { recursive: true });
        await writeFile(join(this.dir, 'commits', `${id}.json`), json);
        await writeFile(join(this.dir, 'HEAD.tmp'), id);
        await rename(join(this.dir, 'HEAD.tmp'), join(this.dir, 'HEAD'));
        return { commit: id };
    }
}
