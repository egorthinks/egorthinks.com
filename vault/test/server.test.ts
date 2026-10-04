import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FsStorage } from '../src/server/storage-fs.ts';

process.env.VAULT_SESSION_SECRET = 'test-secret-test-secret-test-secret-0';
const { sign, verify, safeEqual } = await import('../src/server/session.ts');

const bytes = (s: string) => new TextEncoder().encode(s);

test('a signed session verifies, and any edit to it does not', () => {
    const token = sign({ purpose: 'session', exp: Date.now() / 1000 + 60, cred: 'abc' } as never);
    assert.equal(verify(token, 'session')?.purpose, 'session');

    const [data, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ purpose: 'session', exp: 9e9, cred: 'x' })).toString('base64url');
    assert.equal(verify(`${forged}.${sig}`, 'session'), null);
    assert.equal(verify(`${data}.${sig.slice(0, -1)}A`, 'session'), null);
    assert.equal(verify(token, 'login'), null, 'a token for one purpose is useless for another');
    assert.equal(verify(undefined, 'session'), null);
});

test('an expired session is refused', () => {
    assert.equal(verify(sign({ purpose: 'session', exp: Date.now() / 1000 - 1 }), 'session'), null);
});

test('safeEqual', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
});

test('commits apply on top of the head, and a stale parent is a conflict', async () => {
    const store = new FsStorage(await mkdtemp(join(tmpdir(), 'vault-')));
    assert.deepEqual(await store.state(), { commit: null, files: {} });

    const first = await store.commit(null, [{ path: 'a', bytes: bytes('one') }], 'm');
    assert.ok('commit' in first);
    const second = await store.commit(first.commit, [{ path: 'b', bytes: bytes('two') }], 'm');
    assert.ok('commit' in second);

    // A second device still holding `first` must not overwrite what `second` wrote.
    assert.deepEqual(await store.commit(first.commit, [{ path: 'a', bytes: bytes('stale') }], 'm'), { conflict: true });
    assert.deepEqual(await store.commit(null, [{ path: 'a', bytes: bytes('stale') }], 'm'), { conflict: true });

    const state = await store.state();
    assert.deepEqual(Object.keys(state.files).sort(), ['a', 'b']);
    // Same sha git would give these bytes: `printf one | git hash-object --stdin`
    assert.equal(state.files.a.sha, '43dd47ea691c90a5fa7827892c70241913351963');
    assert.equal(new TextDecoder().decode((await store.readBlob(state.files.a.sha))!), 'one');

    const third = await store.commit(state.commit, [{ path: 'a', bytes: null }], 'm');
    assert.ok('commit' in third);
    assert.deepEqual(Object.keys((await store.state()).files), ['b']);
});

test('concurrent commits on the same parent: exactly one wins', async () => {
    const store = new FsStorage(await mkdtemp(join(tmpdir(), 'vault-')));
    const base = await store.commit(null, [{ path: 'a', bytes: bytes('0') }], 'm');
    assert.ok('commit' in base);
    const results = await Promise.all([1, 2, 3].map((i) => store.commit(base.commit, [{ path: 'a', bytes: bytes(String(i)) }], 'm')));
    assert.equal(results.filter((r) => 'commit' in r).length, 1);
});
