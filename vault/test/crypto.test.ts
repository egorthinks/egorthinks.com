import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    changePassword,
    CorruptObjectError,
    createVault,
    open,
    openJson,
    parseHeader,
    parseRecoveryKey,
    resetPassword,
    rotateRecoveryKey,
    seal,
    sealJson,
    unlockWithPassword,
    unlockWithRecovery,
    WrongKeyError
} from '../src/lib/crypto.ts';
import { decodeFile, encodeFile } from '../src/lib/model.ts';

// Real Argon2id, just cheap enough that the suite runs in a second.
const FAST = { memory: 1024, iterations: 1, parallelism: 1 };
const utf8 = new TextEncoder();

test('a new vault opens with its password and its recovery key', async () => {
    const { header, key, recoveryKey } = await createVault('correct horse', FAST);
    const sealed = await sealJson(key, 'notes/a.md.enc', { hello: 'мир' });

    const byPassword = await unlockWithPassword(parseHeader(JSON.stringify(header)), 'correct horse');
    assert.deepEqual(await openJson(byPassword, 'notes/a.md.enc', sealed), { hello: 'мир' });

    const byRecovery = await unlockWithRecovery(header, recoveryKey.toLowerCase().replace(/-/g, ' '));
    assert.deepEqual(await openJson(byRecovery, 'notes/a.md.enc', sealed), { hello: 'мир' });
});

test('a wrong password is refused, not mis-decrypted', async () => {
    const { header } = await createVault('right', FAST);
    await assert.rejects(unlockWithPassword(header, 'wrong'), WrongKeyError);
});

test('the vault key is never extractable', async () => {
    const { header, key } = await createVault('pw', FAST);
    assert.equal(key.extractable, false);
    assert.equal((await unlockWithPassword(header, 'pw')).extractable, false);
});

test('ciphertext moved to another path fails authentication', async () => {
    const { key } = await createVault('pw', FAST);
    const sealed = await seal(key, 'notes/a.md.enc', utf8.encode('secret'));
    await assert.rejects(open(key, 'notes/b.md.enc', sealed), CorruptObjectError);
    await assert.rejects(open(key, 'manifest.enc', sealed), CorruptObjectError);
});

test('a flipped bit anywhere is caught', async () => {
    const { key } = await createVault('pw', FAST);
    const sealed = await seal(key, 'p', utf8.encode('secret'));
    for (const i of [0, 5, sealed.length - 1]) {
        const bad = sealed.slice();
        bad[i] ^= 1;
        await assert.rejects(open(key, 'p', bad), CorruptObjectError);
    }
});

test('the same plaintext never seals to the same bytes', async () => {
    const { key } = await createVault('pw', FAST);
    const a = await seal(key, 'p', utf8.encode('x'));
    const b = await seal(key, 'p', utf8.encode('x'));
    assert.notDeepEqual(a, b);
});

test('changing the password keeps every note readable and retires the old password', async () => {
    const { header, key } = await createVault('old', FAST);
    const sealed = await seal(key, 'p', utf8.encode('note'));
    const next = await changePassword(header, 'old', 'new');

    await assert.rejects(unlockWithPassword(next, 'old'), WrongKeyError);
    const k = await unlockWithPassword(next, 'new');
    assert.equal(new TextDecoder().decode(await open(k, 'p', sealed)), 'note');
    await assert.rejects(changePassword(header, 'nope', 'x'), WrongKeyError);
});

test('the recovery key resets a forgotten password', async () => {
    const { header, key, recoveryKey } = await createVault('forgotten', FAST);
    const sealed = await seal(key, 'p', utf8.encode('note'));
    const reset = await resetPassword(header, recoveryKey, 'fresh');
    assert.equal(new TextDecoder().decode(await open(reset.key, 'p', sealed)), 'note');
    await unlockWithPassword(reset.header, 'fresh');
    await assert.rejects(unlockWithPassword(reset.header, 'forgotten'), WrongKeyError);
});

test('rotating the recovery key retires the old one', async () => {
    const { header, recoveryKey } = await createVault('pw', FAST);
    const rotated = await rotateRecoveryKey(header, 'pw');
    await assert.rejects(unlockWithRecovery(rotated.header, recoveryKey), WrongKeyError);
    await unlockWithRecovery(rotated.header, rotated.recoveryKey);
});

test('recovery keys survive being typed off paper', () => {
    assert.equal(parseRecoveryKey('ABCD EFGH ijkl MNOP QRST UVWX YZ23 4567').length, 20);
    assert.throws(() => parseRecoveryKey('ABCD'), WrongKeyError);
});

test('attachments keep their type and bytes', () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 255]);
    const back = decodeFile(encodeFile('image/png', 'shot.png', bytes));
    assert.equal(back.type, 'image/png');
    assert.equal(back.name, 'shot.png');
    assert.deepEqual(back.bytes, bytes);
});
