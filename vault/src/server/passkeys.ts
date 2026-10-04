/**
 * Passkeys: the only way in. Public keys live in the data repository at
 * .vault/passkeys.json, which the browser is not allowed to write.
 *
 * The first passkey needs VAULT_SETUP_TOKEN (otherwise whoever found the site
 * first would own it); later ones need a signed-in session. Passkeys are
 * discoverable, so signing in asks for no user name, and user verification
 * (Face ID, fingerprint, device PIN) is required, not preferred.
 *
 * Signature counters are checked but not written back: synced passkeys always
 * report 0, and writing a counter would cost a commit on every sign-in.
 */
import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
    type AuthenticationResponseJSON,
    type RegistrationResponseJSON
} from '@simplewebauthn/server';
import { PATHS } from '../lib/model.ts';
import { readPath, storage } from './storage.ts';

export type StoredPasskey = {
    id: string;
    publicKey: string;
    counter: number;
    transports?: string[];
    name: string;
    created: string;
};

type PasskeyFile = { credentials: StoredPasskey[] };

const RP_NAME = 'egorthinks vault';
// One owner, so one fixed user handle. It is not secret and carries no name.
const USER_ID = new TextEncoder().encode('vault-owner');

export async function listPasskeys(): Promise<{ commit: string | null; credentials: StoredPasskey[] }> {
    const { commit, bytes } = await readPath(PATHS.passkeys);
    const file: PasskeyFile = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : { credentials: [] };
    return { commit, credentials: file.credentials };
}

async function addPasskey(passkey: StoredPasskey) {
    for (let attempt = 0; attempt < 4; attempt++) {
        const { commit, credentials } = await listPasskeys();
        const file: PasskeyFile = { credentials: [...credentials.filter((c) => c.id !== passkey.id), passkey] };
        const bytes = new TextEncoder().encode(JSON.stringify(file, null, 2) + '\n');
        const result = await storage().commit(commit, [{ path: PATHS.passkeys, bytes }], 'Add a passkey');
        if (!('conflict' in result)) return;
    }
    throw new Error('Could not save the passkey: the repository kept changing');
}

export async function registrationOptions(rpID: string) {
    const { credentials } = await listPasskeys();
    return generateRegistrationOptions({
        rpName: RP_NAME,
        rpID,
        userName: 'vault',
        userDisplayName: 'Vault',
        userID: USER_ID,
        attestationType: 'none',
        excludeCredentials: credentials.map((c) => ({ id: c.id, transports: c.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
    });
}

export async function verifyRegistration(response: RegistrationResponseJSON, challenge: string, expectedOrigin: string, rpID: string, name: string) {
    const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: true
    });
    if (!result.verified) throw new Error('Passkey registration did not verify');
    const { credential } = result.registrationInfo;
    await addPasskey({
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: credential.transports,
        name: name.slice(0, 60) || 'Passkey',
        created: new Date().toISOString()
    });
    return credential.id;
}

export async function authenticationOptions(rpID: string) {
    const { credentials } = await listPasskeys();
    return generateAuthenticationOptions({
        rpID,
        userVerification: 'required',
        allowCredentials: credentials.map((c) => ({ id: c.id, transports: c.transports }))
    });
}

export async function verifyAuthentication(response: AuthenticationResponseJSON, challenge: string, expectedOrigin: string, rpID: string) {
    const { credentials } = await listPasskeys();
    const stored = credentials.find((c) => c.id === response.id);
    if (!stored) throw new Error('This passkey is not registered with the vault');
    const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
            id: stored.id,
            publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64url')),
            counter: stored.counter,
            transports: stored.transports
        }
    });
    if (!result.verified) throw new Error('Passkey did not verify');
    return stored.id;
}
