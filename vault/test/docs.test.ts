import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CorruptObjectError, createVault, randomBytes, randomId, type Bytes } from '../src/lib/crypto.ts';
import { CHUNK_BYTES, chunkCount, openDoc, openDocChunk, safeFileName, sealDoc, verifyDoc } from '../src/lib/docs.ts';
import { CLIENT_PATH_RE, PATHS, type DocMeta } from '../src/lib/model.ts';

const FAST = { memory: 1024, iterations: 1, parallelism: 1 };

function meta(size: number, name = 'report.pdf'): DocMeta {
    return { name, type: 'application/pdf', size, added: '2026-10-05T00:00:00.000Z', chunks: chunkCount(size) };
}

function fill(n: number): Bytes {
    // randomBytes is capped at 64 KiB per call by WebCrypto
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 65536) out.set(randomBytes(Math.min(65536, n - i)), i);
    return out;
}

const concat = (parts: Bytes[]): Bytes => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) (out.set(p, at), (at += p.length));
    return out;
};

test('a document of several pieces comes back byte for byte', async () => {
    const { key } = await createVault('pw', FAST);
    const id = randomId();
    const bytes = fill(CHUNK_BYTES * 2 + 12345);
    const m = meta(bytes.length);
    assert.equal(m.chunks, 3);

    const sealed = await sealDoc(key, id, m, bytes);
    assert.equal(sealed.length, 3);
    for (const piece of sealed) assert.ok(piece.length < 4 * 1024 * 1024, 'every piece fits one request');

    const back = await openDoc(key, id, sealed);
    assert.deepEqual(back.meta, m);
    assert.deepEqual(concat(back.parts), bytes);
});

test('an empty document and an exact multiple of the piece size both work', async () => {
    const { key } = await createVault('pw', FAST);
    for (const size of [0, 1, CHUNK_BYTES, CHUNK_BYTES * 2]) {
        const id = randomId();
        const bytes = fill(size);
        const back = await openDoc(key, id, await sealDoc(key, id, meta(size), bytes));
        assert.equal(back.meta.chunks, chunkCount(size));
        assert.deepEqual(concat(back.parts), bytes);
    }
});

test('pieces cannot be reordered, swapped between documents, or opened with the wrong key', async () => {
    const { key } = await createVault('pw', FAST);
    const other = (await createVault('pw', FAST)).key;
    const [a, b] = [randomId(), randomId()];
    const bytes = fill(CHUNK_BYTES * 2 + 1);
    const sa = await sealDoc(key, a, meta(bytes.length), bytes);
    const sb = await sealDoc(key, b, meta(bytes.length), bytes);

    await assert.rejects(openDoc(key, a, [sa[0], sa[2], sa[1]]), CorruptObjectError);
    await assert.rejects(openDoc(key, a, [sa[0], sb[1], sa[2]]), CorruptObjectError);
    await assert.rejects(openDoc(key, b, sa), CorruptObjectError);
    await assert.rejects(openDoc(other, a, sa), CorruptObjectError);
});

test('a missing, surplus or tampered piece is noticed', async () => {
    const { key } = await createVault('pw', FAST);
    const id = randomId();
    const bytes = fill(CHUNK_BYTES * 2 + 7);
    const sealed = await sealDoc(key, id, meta(bytes.length), bytes);

    await assert.rejects(openDoc(key, id, sealed.slice(0, 2)), CorruptObjectError, 'last piece dropped');
    await assert.rejects(openDoc(key, id, [...sealed, sealed[1]]), CorruptObjectError, 'extra piece');
    await assert.rejects(openDoc(key, id, sealed.slice(1)), CorruptObjectError, 'first piece dropped');

    const bad = sealed[1].slice();
    bad[bad.length - 1] ^= 1;
    await assert.rejects(openDoc(key, id, [sealed[0], bad, sealed[2]]), CorruptObjectError);
});

test('the index cannot quietly disagree with the document', async () => {
    const { key } = await createVault('pw', FAST);
    const id = randomId();
    const bytes = fill(100);
    const m = meta(100);
    const first = await openDocChunk(key, id, 0, (await sealDoc(key, id, m, bytes))[0]);
    assert.throws(() => verifyDoc(id, first.header!, [first.data], { ...m, size: 99 }), CorruptObjectError);
    assert.throws(() => verifyDoc(id, first.header!, [first.data], { ...m, chunks: 2 }), CorruptObjectError);
    verifyDoc(id, first.header!, [first.data], m);
});

test('file names are made safe to show and to save', () => {
    assert.equal(safeFileName('report.pdf'), 'report.pdf');
    assert.equal(safeFileName('../../etc/passwd'), 'passwd');
    assert.equal(safeFileName('C:\\Users\\me\\secret.xlsx'), 'secret.xlsx');
    assert.equal(safeFileName('.htaccess'), 'htaccess');
    assert.equal(safeFileName('a<b>:c|d?.docx'), 'a b c d .docx');
    assert.equal(safeFileName('tab\tand\nnewline.txt'), 'tab and newline.txt');
    assert.equal(safeFileName('   '), 'file');
    assert.equal(safeFileName('///'), 'file');
    assert.equal(safeFileName('Договор №5.pdf'), 'Договор №5.pdf');
    const long = safeFileName('x'.repeat(300) + '.pdf');
    assert.equal(long.length, 120);
    assert.ok(long.endsWith('.pdf'));
});

test('the server accepts exactly the paths the client writes', () => {
    const id = 'a'.repeat(32);
    for (const ok of [PATHS.doc(id, 0), PATHS.doc(id, 16), PATHS.note(id), PATHS.file(id), PATHS.manifest, PATHS.header]) {
        assert.ok(CLIENT_PATH_RE.test(ok), ok);
    }
    for (const bad of [
        PATHS.passkeys,
        `docs/${id}/1000.enc`,
        `docs/${id}/-1.enc`,
        `docs/${id}/../x.enc`,
        `docs/${id}.enc`,
        `docs/${id}/0.enc/x`,
        `docs/short/0.enc`,
        `.vault/passkeys.json`
    ]) {
        assert.ok(!CLIENT_PATH_RE.test(bad), bad);
    }
});
