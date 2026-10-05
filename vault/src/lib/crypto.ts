/**
 * The vault's cryptography. Runs unchanged in the browser and in Node (the
 * offline decrypt script and the tests), so it touches nothing but WebCrypto
 * and hash-wasm, and uses only type syntax Node can strip.
 *
 * Key hierarchy:
 *
 *   master password --Argon2id--> password KEK --+
 *                                                 +--unwraps--> vault key --AES-256-GCM--> every object
 *   recovery key ------HKDF-----> recovery KEK --+
 *
 * The vault key is random, not derived, so changing the password rewraps 32
 * bytes instead of re-encrypting every note. Both wrapped copies live in
 * vault.json, which is the only file in the repository that is not ciphertext,
 * and holds nothing that helps without the password or the recovery key.
 *
 * Every encrypted object is bound to its path through the GCM associated data,
 * so whoever can write to the repository cannot swap one note's ciphertext for
 * another's (or a note for the manifest) without decryption failing.
 *
 * Object layout: "EGV1" | 12-byte nonce | ciphertext with 16-byte GCM tag.
 */
import { argon2id } from 'hash-wasm';

export const FORMAT = 'egorthinks-vault';
export const VERSION = 1;

/** Bytes backed by a plain ArrayBuffer: what WebCrypto accepts. */
export type Bytes = Uint8Array<ArrayBuffer>;

const MAGIC = new Uint8Array([0x45, 0x47, 0x56, 0x31]); // "EGV1"
const NONCE_BYTES = 12;
const KEY_BYTES = 32;
const RECOVERY_BYTES = 20; // 160 bits, written as 32 base32 characters
const AAD_PREFIX = `${FORMAT}/v${VERSION}:`;

export type KdfParams = {
    alg: 'argon2id';
    /** KiB */
    memory: number;
    iterations: number;
    parallelism: number;
    salt: string;
};

export type WrappedKey = { nonce: string; data: string };

export type VaultHeader = {
    format: typeof FORMAT;
    version: number;
    created: string;
    slots: {
        password: WrappedKey & { kdf: KdfParams };
        recovery: WrappedKey;
        /**
         * Optional duress password. It opens the vault like the master password,
         * and the caller destroys the chat history first (see unlock()).
         */
        panic?: WrappedKey & { kdf: KdfParams };
    };
};

/**
 * OWASP's first recommended Argon2id setting is 19 MiB / 2 passes. This spends
 * more, because unlocking happens a few times a day and every extra unit of
 * cost here is paid in full by anyone guessing at a stolen vault.json. Around
 * half a second to a second and a half on a phone.
 */
export const DEFAULT_KDF = { memory: 64 * 1024, iterations: 3, parallelism: 1 } as const;

export class WrongKeyError extends Error {
    constructor(message = 'Wrong password or key') {
        super(message);
        this.name = 'WrongKeyError';
    }
}

export class CorruptObjectError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CorruptObjectError';
    }
}

const subtle = () => globalThis.crypto.subtle;
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder('utf-8', { fatal: true });

export function randomBytes(n: number): Bytes {
    return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

/** 128 random bits as hex. Used for note and file names, which carry nothing. */
export function randomId(): string {
    return toHex(randomBytes(16));
}

/* ------------------------------------------------------------------------ */
/* Encodings                                                                */
/* ------------------------------------------------------------------------ */

export function toHex(bytes: Bytes): string {
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
}

export function toBase64(bytes: Bytes): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
}

export function fromBase64(b64: string): Bytes {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function toBase32(bytes: Bytes): string {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const b of bytes) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5) {
            out += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
    return out;
}

function fromBase32(text: string): Bytes {
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const ch of text) {
        const i = BASE32.indexOf(ch);
        if (i < 0) throw new WrongKeyError('Recovery key contains characters it cannot');
        value = (value << 5) | i;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return new Uint8Array(out);
}

/** "ABCD-EFGH-..." for printing. */
export function formatRecoveryKey(bytes: Bytes): string {
    return toBase32(bytes)
        .match(/.{1,4}/g)!
        .join('-');
}

/** Tolerates lowercase, spaces and missing dashes: it will be typed off paper. */
export function parseRecoveryKey(text: string): Bytes {
    const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B');
    const bytes = fromBase32(clean);
    if (bytes.length !== RECOVERY_BYTES) throw new WrongKeyError('A recovery key is 32 characters long');
    return bytes;
}

/* ------------------------------------------------------------------------ */
/* Primitives                                                               */
/* ------------------------------------------------------------------------ */

async function aesKey(raw: Bytes, extractable = false): Promise<CryptoKey> {
    return subtle().importKey('raw', raw, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);
}

async function gcmEncrypt(key: CryptoKey, plaintext: Bytes, aad: string): Promise<{ nonce: Bytes; data: Bytes }> {
    const nonce = randomBytes(NONCE_BYTES);
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv: nonce, additionalData: utf8.encode(aad) }, key, plaintext);
    return { nonce, data: new Uint8Array(ct) };
}

async function gcmDecrypt(key: CryptoKey, nonce: Bytes, data: Bytes, aad: string): Promise<Bytes> {
    try {
        const pt = await subtle().decrypt({ name: 'AES-GCM', iv: nonce, additionalData: utf8.encode(aad) }, key, data);
        return new Uint8Array(pt);
    } catch {
        throw new WrongKeyError();
    }
}

async function passwordKek(password: string, kdf: KdfParams): Promise<CryptoKey> {
    if (kdf.alg !== 'argon2id') throw new CorruptObjectError(`Unknown KDF ${kdf.alg}`);
    const raw = await argon2id({
        password: password.normalize('NFC'),
        salt: fromBase64(kdf.salt),
        iterations: kdf.iterations,
        parallelism: kdf.parallelism,
        memorySize: kdf.memory,
        hashLength: KEY_BYTES,
        outputType: 'binary'
    });
    return aesKey(raw as Bytes);
}

async function recoveryKek(recovery: Bytes): Promise<CryptoKey> {
    // The recovery key is already 160 random bits; stretching it buys nothing.
    const ikm = await subtle().importKey('raw', recovery, 'HKDF', false, ['deriveKey']);
    return subtle().deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8.encode(`${AAD_PREFIX}recovery`) },
        ikm,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function wrap(kek: CryptoKey, vaultKey: Bytes, slot: string): Promise<WrappedKey> {
    const { nonce, data } = await gcmEncrypt(kek, vaultKey, `${AAD_PREFIX}slot/${slot}`);
    return { nonce: toBase64(nonce), data: toBase64(data) };
}

async function unwrap(kek: CryptoKey, wrapped: WrappedKey, slot: string): Promise<Bytes> {
    const raw = await gcmDecrypt(kek, fromBase64(wrapped.nonce), fromBase64(wrapped.data), `${AAD_PREFIX}slot/${slot}`);
    if (raw.length !== KEY_BYTES) throw new CorruptObjectError('Vault key has the wrong length');
    return raw;
}

async function passwordSlot(password: string, vaultKey: Bytes, params: Omit<KdfParams, 'alg' | 'salt'>, slot: 'password' | 'panic' = 'password') {
    const kdf: KdfParams = { alg: 'argon2id', ...params, salt: toBase64(randomBytes(16)) };
    return { kdf, ...(await wrap(await passwordKek(password, kdf), vaultKey, slot)) };
}

async function opensPanicSlot(header: VaultHeader, password: string): Promise<boolean> {
    const slot = header.slots.panic;
    if (!slot) return false;
    try {
        (await unwrap(await passwordKek(password, slot.kdf), slot, 'panic')).fill(0);
        return true;
    } catch (err) {
        if (err instanceof WrongKeyError) return false;
        throw err;
    }
}

/* ------------------------------------------------------------------------ */
/* Vault lifecycle                                                          */
/* ------------------------------------------------------------------------ */

export type Unlocked = { header: VaultHeader; key: CryptoKey };

export async function createVault(password: string, kdfParams: Omit<KdfParams, 'alg' | 'salt'> = DEFAULT_KDF) {
    const vaultKey = randomBytes(KEY_BYTES);
    const recovery = randomBytes(RECOVERY_BYTES);
    const header: VaultHeader = {
        format: FORMAT,
        version: VERSION,
        created: new Date().toISOString(),
        slots: {
            password: await passwordSlot(password, vaultKey, kdfParams),
            recovery: await wrap(await recoveryKek(recovery), vaultKey, 'recovery')
        }
    };
    const key = await aesKey(vaultKey);
    vaultKey.fill(0);
    return { header, key, recoveryKey: formatRecoveryKey(recovery) };
}

export function parseHeader(json: string): VaultHeader {
    const header = JSON.parse(json) as VaultHeader;
    if (header.format !== FORMAT) throw new CorruptObjectError('vault.json is not a vault header');
    if (header.version !== VERSION) throw new CorruptObjectError(`Vault version ${header.version} is newer than this code`);
    return header;
}

async function rawFromPassword(header: VaultHeader, password: string) {
    const slot = header.slots.password;
    return unwrap(await passwordKek(password, slot.kdf), slot, 'password');
}

async function rawFromRecovery(header: VaultHeader, recoveryKey: string) {
    return unwrap(await recoveryKek(parseRecoveryKey(recoveryKey)), header.slots.recovery, 'recovery');
}

export async function unlockWithPassword(header: VaultHeader, password: string): Promise<CryptoKey> {
    const raw = await rawFromPassword(header, password);
    try {
        return await aesKey(raw);
    } finally {
        raw.fill(0);
    }
}

export async function unlockWithRecovery(header: VaultHeader, recoveryKey: string): Promise<CryptoKey> {
    const raw = await rawFromRecovery(header, recoveryKey);
    try {
        return await aesKey(raw);
    } finally {
        raw.fill(0);
    }
}

/**
 * The master password first, then the panic password. `panic: true` tells the
 * caller to destroy the chat history before showing anything: from the outside
 * the vault simply opens, with no chats in it.
 */
export async function unlock(header: VaultHeader, password: string): Promise<{ key: CryptoKey; panic: boolean }> {
    try {
        return { key: await unlockWithPassword(header, password), panic: false };
    } catch (err) {
        if (!(err instanceof WrongKeyError) || !header.slots.panic) throw err;
    }
    const slot = header.slots.panic;
    const raw = await unwrap(await passwordKek(password, slot.kdf), slot, 'panic');
    try {
        return { key: await aesKey(raw), panic: true };
    } finally {
        raw.fill(0);
    }
}

/** Sets (or replaces) the panic password. It must differ from the master password, or it could never fire. */
export async function setPanicPassword(header: VaultHeader, master: string, panic: string): Promise<VaultHeader> {
    if (panic === master) throw new Error('The panic password must differ from the master password.');
    const raw = await rawFromPassword(header, master);
    try {
        const { kdf } = header.slots.password;
        const slot = await passwordSlot(panic, raw, { memory: kdf.memory, iterations: kdf.iterations, parallelism: kdf.parallelism }, 'panic');
        return { ...header, slots: { ...header.slots, panic: slot } };
    } finally {
        raw.fill(0);
    }
}

export async function removePanicPassword(header: VaultHeader, master: string): Promise<VaultHeader> {
    (await rawFromPassword(header, master)).fill(0);
    const { panic: _, ...slots } = header.slots;
    return { ...header, slots };
}

/** New password, proven by the current one. The recovery and panic slots are untouched. */
export async function changePassword(header: VaultHeader, current: string, next: string): Promise<VaultHeader> {
    // A master password equal to the panic password would shadow it for good.
    if (await opensPanicSlot(header, next)) throw new Error('That is the panic password. Choose another.');
    const raw = await rawFromPassword(header, current);
    try {
        const { kdf } = header.slots.password;
        const slot = await passwordSlot(next, raw, { memory: kdf.memory, iterations: kdf.iterations, parallelism: kdf.parallelism });
        return { ...header, slots: { ...header.slots, password: slot } };
    } finally {
        raw.fill(0);
    }
}

/** Forgotten password: the recovery key sets a new one. */
export async function resetPassword(header: VaultHeader, recoveryKey: string, next: string): Promise<Unlocked> {
    const raw = await rawFromRecovery(header, recoveryKey);
    try {
        const { kdf } = header.slots.password;
        const slot = await passwordSlot(next, raw, { memory: kdf.memory, iterations: kdf.iterations, parallelism: kdf.parallelism });
        return { header: { ...header, slots: { ...header.slots, password: slot } }, key: await aesKey(raw) };
    } finally {
        raw.fill(0);
    }
}

/** A lost or exposed recovery key is replaced; the old one stops working. */
export async function rotateRecoveryKey(header: VaultHeader, password: string) {
    const raw = await rawFromPassword(header, password);
    try {
        const recovery = randomBytes(RECOVERY_BYTES);
        const slot = await wrap(await recoveryKek(recovery), raw, 'recovery');
        return { header: { ...header, slots: { ...header.slots, recovery: slot } }, recoveryKey: formatRecoveryKey(recovery) };
    } finally {
        raw.fill(0);
    }
}

/* ------------------------------------------------------------------------ */
/* Objects                                                                  */
/* ------------------------------------------------------------------------ */

export async function seal(key: CryptoKey, path: string, plaintext: Bytes): Promise<Bytes> {
    const { nonce, data } = await gcmEncrypt(key, plaintext, AAD_PREFIX + path);
    const out = new Uint8Array(MAGIC.length + NONCE_BYTES + data.length);
    out.set(MAGIC, 0);
    out.set(nonce, MAGIC.length);
    out.set(data, MAGIC.length + NONCE_BYTES);
    return out;
}

export async function open(key: CryptoKey, path: string, sealed: Bytes): Promise<Bytes> {
    if (sealed.length < MAGIC.length + NONCE_BYTES + 16 || !MAGIC.every((b, i) => sealed[i] === b)) {
        throw new CorruptObjectError(`${path} is not a vault object`);
    }
    const nonce = sealed.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES);
    const data = sealed.subarray(MAGIC.length + NONCE_BYTES);
    try {
        return await gcmDecrypt(key, nonce, data, AAD_PREFIX + path);
    } catch {
        throw new CorruptObjectError(`${path} failed authentication: wrong key, damaged, or moved from another path`);
    }
}

export async function sealJson(key: CryptoKey, path: string, value: unknown): Promise<Bytes> {
    return seal(key, path, utf8.encode(JSON.stringify(value)));
}

export async function openJson<T>(key: CryptoKey, path: string, sealed: Bytes): Promise<T> {
    return JSON.parse(fromUtf8.decode(await open(key, path, sealed))) as T;
}
