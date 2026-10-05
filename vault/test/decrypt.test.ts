import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createVault, randomBytes, randomId, sealJson, type Bytes } from '../src/lib/crypto.ts';
import { CHUNK_BYTES, chunkCount, sealDoc } from '../src/lib/docs.ts';
import { PATHS, type DocMeta, type Note } from '../src/lib/model.ts';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'decrypt.ts');
const FAST = { memory: 1024, iterations: 1, parallelism: 1 };

function fill(n: number): Bytes {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 65536) out.set(randomBytes(Math.min(65536, n - i)), i);
    return out;
}

async function put(repo: string, path: string, bytes: Uint8Array | string) {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), bytes);
}

/** A data repository as the browser would have left it: a note, a three-piece pdf, and two documents with one name. */
async function fixture() {
    const { header, key } = await createVault('pw', FAST);
    const repo = await mkdtemp(join(tmpdir(), 'vault-repo-'));
    await put(repo, PATHS.header, JSON.stringify(header));

    const noteId = randomId();
    const note: Note = { v: 1, id: noteId, title: 'Hello', body: 'text', created: '2026-10-05T00:00:00Z', updated: '2026-10-05T00:00:00Z', files: [] };
    await put(repo, PATHS.note(noteId), await sealJson(key, PATHS.note(noteId), note));

    const docs: { id: string; bytes: Bytes; name: string }[] = [];
    for (const [name, size] of [
        ['report.pdf', CHUNK_BYTES * 2 + 99],
        ['report.pdf', 10],
        ['../../evil.docx', 5]
    ] as const) {
        const id = randomId();
        const bytes = fill(size);
        const meta: DocMeta = { name, type: 'application/pdf', size, added: '2026-10-05T00:00:00Z', chunks: chunkCount(size) };
        const sealed = await sealDoc(key, id, meta, bytes);
        for (const [i, piece] of sealed.entries()) await put(repo, PATHS.doc(id, i), piece);
        docs.push({ id, bytes, name });
    }
    return { repo, docs };
}

const run = (repo: string, out: string) =>
    spawnSync(process.execPath, [SCRIPT, repo, out], { env: { ...process.env, VAULT_PASSWORD: 'pw' }, encoding: 'utf8' });

test('the offline decryptor restores notes and documents, with safe and unique names', async () => {
    const { repo, docs } = await fixture();
    const out = await mkdtemp(join(tmpdir(), 'vault-out-'));
    const res = run(repo, out);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /1 note\(s\).* 3 document\(s\)/);

    const names = (await readdir(join(out, 'documents'))).sort();
    assert.equal(names.length, 3);
    assert.ok(names.includes('report.pdf'), 'first keeps its name');
    assert.ok(names.includes('evil.docx'), 'path components are stripped');
    assert.ok(
        names.some((n) => /^report \([0-9a-f]{6}\)\.pdf$/.test(n)),
        'the duplicate is told apart'
    );

    const big = docs[0];
    const restored = await Promise.all(names.map(async (n) => ({ n, b: await readFile(join(out, 'documents', n)) })));
    assert.ok(
        restored.some((r) => r.b.length === big.bytes.length && Buffer.compare(r.b, big.bytes) === 0),
        'the multi-piece document is intact'
    );
    await rm(repo, { recursive: true });
    await rm(out, { recursive: true });
});

test('a document with a missing piece is refused, not written short', async () => {
    const { repo, docs } = await fixture();
    await rm(join(repo, PATHS.doc(docs[0].id, 1)));
    const out = await mkdtemp(join(tmpdir(), 'vault-out-'));
    const res = run(repo, out);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /pieces|authentication|size|bytes/i);
    await rm(repo, { recursive: true });
    await rm(out, { recursive: true });
});

test('a wrong password writes nothing', async () => {
    const { repo } = await fixture();
    const out = await mkdtemp(join(tmpdir(), 'vault-out-'));
    const res = spawnSync(process.execPath, [SCRIPT, repo, out], { env: { ...process.env, VAULT_PASSWORD: 'nope' }, encoding: 'utf8' });
    assert.notEqual(res.status, 0);
    assert.deepEqual(await readdir(out), []);
    await rm(repo, { recursive: true });
    await rm(out, { recursive: true });
});
