/**
 * A private GitHub repository as the vault's disk.
 *
 * Reads go through REST (ref -> commit -> recursive tree, and raw blobs by sha).
 * Writes are one GraphQL createCommitOnBranch per save: every file of the save
 * in a single commit, applied only if the branch still points at the commit the
 * client last saw (expectedHeadOid). One request per save matters: GitHub caps
 * content-creating requests at roughly 500 an hour, and the git-data REST route
 * (blob, blob, tree, commit, ref) would spend five.
 *
 * The token needs Contents: read and write on this one repository, nothing else.
 * It never leaves the server, and what it can read is ciphertext anyway.
 */
import type { Bytes } from '../lib/crypto.ts';
import type { Change, CommitResult, State, Storage, Tree } from './storage.ts';

const API = 'https://api.github.com';

const README = `# Vault data

Encrypted notes for vault.egorthinks.com. Nothing here is readable without the
master password or the recovery key; the server that writes here never sees either.

- \`vault.json\`: key slots (Argon2id-wrapped and recovery-wrapped vault key)
- \`manifest.enc\`: encrypted index of notes
- \`notes/*.md.enc\`: one encrypted note each
- \`files/*.enc\`: encrypted attachments
- \`.vault/passkeys.json\`: public keys of the passkeys allowed to sign in

To get plain markdown back without the website: clone this repository, then from
the egorthinks.com repository run

    cd vault && npm install && npm run decrypt -- <path-to-this-clone> <output-dir>

Format: every \`.enc\` file is \`EGV1 | 12-byte nonce | AES-256-GCM ciphertext+tag\`,
with \`egorthinks-vault/v1:<path>\` as associated data. See vault/src/lib/crypto.ts.
`;

class GitHubError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export class GitHubStorage implements Storage {
    private repo: string;
    private token: string;
    private branch: string;

    constructor(repo: string, token: string, branch: string) {
        this.repo = repo;
        this.token = token;
        this.branch = branch;
    }

    private async rest(path: string, init: RequestInit & { accept?: string } = {}): Promise<Response> {
        const res = await fetch(`${API}/repos/${this.repo}${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${this.token}`,
                Accept: init.accept ?? 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'egorthinks-vault',
                ...(init.body ? { 'Content-Type': 'application/json' } : {})
            },
            cache: 'no-store'
        });
        if (!res.ok) throw new GitHubError(res.status, `GitHub ${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
        return res;
    }

    private async headCommit(): Promise<string | null> {
        try {
            const ref = (await (await this.rest(`/git/ref/heads/${this.branch}`)).json()) as { object: { sha: string } };
            return ref.object.sha;
        } catch (err) {
            // 409: the repository has no commits yet. 404: no such branch, or no such repository.
            if (err instanceof GitHubError && (err.status === 409 || err.status === 404)) {
                await this.rest(''); // throws if the repository itself is missing or the token cannot see it
                return null;
            }
            throw err;
        }
    }

    async state(): Promise<State> {
        const commit = await this.headCommit();
        if (!commit) return { commit: null, files: {} };
        const { tree } = (await (await this.rest(`/git/commits/${commit}`)).json()) as { tree: { sha: string } };
        const listing = (await (await this.rest(`/git/trees/${tree.sha}?recursive=1`)).json()) as {
            truncated: boolean;
            tree: { path: string; type: string; sha: string; size?: number }[];
        };
        if (listing.truncated) throw new Error('Repository tree is too large to list in one request');
        const files: Tree = {};
        for (const e of listing.tree) if (e.type === 'blob') files[e.path] = { sha: e.sha, size: e.size ?? 0 };
        return { commit, files };
    }

    async readBlob(sha: string): Promise<Bytes | null> {
        try {
            const res = await this.rest(`/git/blobs/${sha}`, { accept: 'application/vnd.github.raw+json' });
            return new Uint8Array(await res.arrayBuffer());
        } catch (err) {
            if (err instanceof GitHubError && (err.status === 404 || err.status === 422)) return null;
            throw err;
        }
    }

    /** GraphQL cannot commit to an empty repository, so the first commit is the README, over REST. */
    private async initialize(): Promise<string> {
        const res = await this.rest('/contents/README.md', {
            method: 'PUT',
            body: JSON.stringify({ message: 'Start the vault', content: Buffer.from(README).toString('base64'), branch: this.branch })
        });
        const body = (await res.json()) as { commit: { sha: string } };
        return body.commit.sha;
    }

    async commit(parent: string | null, changes: Change[], message: string): Promise<CommitResult> {
        let expected = parent;
        if (expected === null) {
            // The client saw an empty repository. If it still is, lay the first commit and build on it.
            if ((await this.headCommit()) !== null) return { conflict: true };
            expected = await this.initialize();
        }

        const additions = changes.filter((c) => c.bytes).map((c) => ({ path: c.path, contents: Buffer.from(c.bytes!).toString('base64') }));
        const deletions = changes.filter((c) => !c.bytes).map((c) => ({ path: c.path }));

        const res = await fetch(`${API}/graphql`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', 'User-Agent': 'egorthinks-vault' },
            cache: 'no-store',
            body: JSON.stringify({
                query: `mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }`,
                variables: {
                    input: {
                        branch: { repositoryNameWithOwner: this.repo, branchName: this.branch },
                        message: { headline: message },
                        expectedHeadOid: expected,
                        fileChanges: { additions, deletions }
                    }
                }
            })
        });
        if (!res.ok) throw new GitHubError(res.status, `GitHub GraphQL: ${res.status} ${await res.text()}`);
        const body = (await res.json()) as {
            data?: { createCommitOnBranch?: { commit: { oid: string } } };
            errors?: { type?: string; message: string }[];
        };
        if (body.errors?.length) {
            if (body.errors.some((e) => e.type === 'STALE_DATA' || /expected branch to point to/i.test(e.message))) return { conflict: true };
            throw new Error(`GitHub GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
        }
        return { commit: body.data!.createCommitOnBranch!.commit.oid };
    }
}
