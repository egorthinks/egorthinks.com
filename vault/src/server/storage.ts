/**
 * The vault's storage is a git repository: every save is a commit, so history
 * and backups come free and `git clone` is a complete (still encrypted) copy.
 *
 * The browser reads by git blob sha. Blobs are immutable, so it may cache them
 * forever. It writes whole commits: a set of paths and their new bytes (or
 * deletions), applied only if nobody committed since the client last looked.
 * A stale parent is a conflict, never a merge; the client re-reads and retries.
 */
import type { Bytes } from '../lib/crypto.ts';
import { FsStorage } from './storage-fs.ts';
import { GitHubStorage } from './storage-github.ts';
import { env } from './config.ts';

export type Tree = Record<string, { sha: string; size: number }>;
export type State = { commit: string | null; files: Tree };
/** bytes: null deletes the path. */
export type Change = { path: string; bytes: Bytes | null };
export type CommitResult = { commit: string } | { conflict: true };

export interface Storage {
    state(): Promise<State>;
    readBlob(sha: string): Promise<Bytes | null>;
    commit(parent: string | null, changes: Change[], message: string): Promise<CommitResult>;
}

let instance: Storage | undefined;

export function storage(): Storage {
    if (instance) return instance;
    if (env('VAULT_STORAGE') === 'fs') {
        if (process.env.VERCEL) throw new Error('VAULT_STORAGE=fs is for local development only');
        instance = new FsStorage(env('VAULT_FS_DIR') || '.vault-data');
    } else {
        const repo = env('VAULT_GITHUB_REPO');
        const token = env('VAULT_GITHUB_TOKEN');
        if (!repo || !token) throw new Error('VAULT_GITHUB_REPO and VAULT_GITHUB_TOKEN must be set');
        instance = new GitHubStorage(repo, token, env('VAULT_GITHUB_BRANCH') || 'main');
    }
    return instance;
}

/** Read one path at the current head, or null if it does not exist. */
export async function readPath(path: string): Promise<{ commit: string | null; bytes: Bytes | null }> {
    const s = await storage().state();
    const entry = s.files[path];
    return { commit: s.commit, bytes: entry ? await storage().readBlob(entry.sha) : null };
}
