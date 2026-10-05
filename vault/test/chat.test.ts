import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
    changePassword,
    createVault,
    CorruptObjectError,
    randomId,
    removePanicPassword,
    resetPassword,
    setPanicPassword,
    unlock,
    unlockWithPassword,
    WrongKeyError
} from '../src/lib/crypto.ts';
import {
    chatKeyName,
    isExpired,
    newChatKey,
    openChat,
    openChatMeta,
    parseChatKeyName,
    sealChat,
    sealChatMeta,
    titleFrom,
    unwrapChatKey,
    type Chat
} from '../src/lib/chat.ts';

const FAST = { memory: 1024, iterations: 1, parallelism: 1 };

test('the panic password opens the vault and says so; the master password does not', async () => {
    const { header } = await createVault('master pw', FAST);
    const withPanic = await setPanicPassword(header, 'master pw', 'panic pw');

    assert.deepEqual((await unlock(withPanic, 'master pw')).panic, false);
    assert.deepEqual((await unlock(withPanic, 'panic pw')).panic, true);
    await assert.rejects(unlock(withPanic, 'neither'), WrongKeyError);

    // Both open the same vault key.
    const { key: a } = await unlock(withPanic, 'master pw');
    const { key: b } = await unlock(withPanic, 'panic pw');
    const id = randomId();
    const { key: chatKey, wrapped } = await newChatKey(a, id);
    const meta = await sealChatMeta(chatKey, id, { title: 't', model: 'm', created: '', updated: '' });
    assert.equal((await openChatMeta(await unwrapChatKey(b, id, wrapped), id, meta)).title, 't');
});

test('panic password rules: must differ, needs the master to set or remove, survives password changes', async () => {
    const { header, recoveryKey } = await createVault('master pw', FAST);
    await assert.rejects(setPanicPassword(header, 'master pw', 'master pw'), /must differ/);
    await assert.rejects(setPanicPassword(header, 'wrong', 'panic pw'), WrongKeyError);

    const withPanic = await setPanicPassword(header, 'master pw', 'panic pw');
    await assert.rejects(changePassword(withPanic, 'master pw', 'panic pw'), /panic password/);

    const changed = await changePassword(withPanic, 'master pw', 'new master');
    assert.equal((await unlock(changed, 'panic pw')).panic, true, 'still armed after a password change');
    const reset = await resetPassword(changed, recoveryKey, 'after reset');
    assert.equal((await unlock(reset.header, 'panic pw')).panic, true, 'still armed after a reset');

    await assert.rejects(removePanicPassword(changed, 'wrong'), WrongKeyError);
    const removed = await removePanicPassword(changed, 'new master');
    assert.equal(removed.slots.panic, undefined);
    await assert.rejects(unlock(removed, 'panic pw'), WrongKeyError);
    await unlockWithPassword(removed, 'new master');
});

test('a vault without a panic slot unlocks exactly as before', async () => {
    const { header } = await createVault('pw', FAST);
    assert.equal((await unlock(header, 'pw')).panic, false);
    await assert.rejects(unlock(header, 'nope'), WrongKeyError);
});

test('chat key names round-trip and reject anything else', () => {
    const id = 'a'.repeat(32);
    const wrapped = 'A'.repeat(86);
    for (const expires of [null, 1_900_000_000]) {
        const name = chatKeyName({ id, expires, wrapped });
        assert.deepEqual(parseChatKeyName(name), { id, expires, wrapped });
    }
    assert.throws(() => chatKeyName({ id: 'short', expires: null, wrapped }));
    assert.throws(() => chatKeyName({ id, expires: -1, wrapped }));
    assert.throws(() => chatKeyName({ id, expires: 1.5, wrapped }));
    assert.throws(() => chatKeyName({ id, expires: null, wrapped: 'has/slash' + 'A'.repeat(80) }));
    for (const bad of [
        'notes/x',
        `chatkeys/${id}.never`,
        `chatkeys/${id}.soon.${wrapped}`,
        `chatkeys/${id}.never.${wrapped}/x`,
        `chatkeys/../${id}.never.${wrapped}`
    ]) {
        assert.equal(parseChatKeyName(bad), null, bad);
    }
    assert.equal(isExpired({ expires: null }), false);
    assert.equal(isExpired({ expires: 100 }, 100), true);
    assert.equal(isExpired({ expires: 101 }, 100), false);
});

test('a chat opens only with its own key, at its own path', async () => {
    const { key: vaultKey } = await createVault('pw', FAST);
    const [a, b] = [randomId(), randomId()];
    const ka = await newChatKey(vaultKey, a);
    const kb = await newChatKey(vaultKey, b);
    assert.equal(ka.key.extractable, false);

    const chat: Chat = { v: 1, id: a, messages: [{ role: 'user', content: 'секрет', at: '' }] };
    const sealed = await sealChat(ka.key, chat);
    assert.deepEqual(await openChat(await unwrapChatKey(vaultKey, a, ka.wrapped), a, sealed), chat);

    await assert.rejects(openChat(kb.key, a, sealed), CorruptObjectError, 'another chat key');
    await assert.rejects(openChat(ka.key, b, sealed), CorruptObjectError, 'moved to another chat');
    await assert.rejects(unwrapChatKey(vaultKey, b, ka.wrapped), CorruptObjectError, 'wrapped key moved to another chat');
    const other = (await createVault('pw', FAST)).key;
    await assert.rejects(unwrapChatKey(other, a, ka.wrapped), CorruptObjectError, 'another vault');
});

test('titles come from the first line, trimmed', () => {
    assert.equal(titleFrom('  Hello there\nsecond line'), 'Hello there');
    assert.equal(titleFrom(''), 'New chat');
    assert.equal(titleFrom('x'.repeat(100)).length, 60);
});

test('the key store creates, replaces, expires and burns', async () => {
    process.env.VAULT_STORAGE = 'fs';
    process.env.VAULT_FS_DIR = await mkdtemp(join(tmpdir(), 'vault-keys-'));
    const keys = await import('../src/server/chatkeys.ts');
    const [a, b, c] = [randomId(), randomId(), randomId()];
    const w = 'B'.repeat(86);
    const now = Math.floor(Date.now() / 1000);

    await keys.putChatKey({ id: a, expires: null, wrapped: w });
    await keys.putChatKey({ id: b, expires: now + 3600, wrapped: w });
    await keys.putChatKey({ id: c, expires: now - 1, wrapped: w });
    const live = await keys.listChatKeys();
    assert.deepEqual(live.map((k) => k.id).sort(), [a, b].sort(), 'the expired key is not listed');
    assert.equal(await keys.expireChatKeys(), 0, 'and was already deleted by the listing');

    await keys.putChatKey({ id: a, expires: now + 60, wrapped: w });
    const afterChange = await keys.listChatKeys();
    assert.equal(afterChange.filter((k) => k.id === a).length, 1, 'changing the expiry replaces, never duplicates');
    assert.equal(afterChange.find((k) => k.id === a)!.expires, now + 60);

    await keys.deleteChatKey(b);
    assert.deepEqual(
        (await keys.listChatKeys()).map((k) => k.id),
        [a]
    );

    await keys.putChatKey({ id: b, expires: null, wrapped: w });
    assert.equal(await keys.burnChatKeys(), 2);
    assert.deepEqual(await keys.listChatKeys(), []);
});
