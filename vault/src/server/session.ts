/**
 * Signed cookies, no server-side session store. A cookie is
 * base64url(JSON payload) "." base64url(HMAC-SHA256), and is only ever trusted
 * after the MAC checks out and the expiry is in the future.
 *
 * The session gates the ciphertext, not the plaintext: a stolen session gets
 * encrypted blobs and nothing else. It is still HttpOnly, Secure, SameSite=Strict
 * and __Host- prefixed (no Domain, path /), so the blog on the parent domain
 * cannot set or read it.
 */
import type { AstroCookies } from 'astro';
import { createHmac } from 'node:crypto';
import { sessionSecret } from './config.ts';

export const SESSION_COOKIE = '__Host-vault-session';
export const CHALLENGE_COOKIE = '__Host-vault-challenge';
export const SESSION_SECONDS = 12 * 60 * 60;
const CHALLENGE_SECONDS = 5 * 60;

type Signed = { exp: number; purpose: string };
export type Session = Signed & { purpose: 'session'; cred: string };
export type Challenge = Signed & { purpose: 'register' | 'login'; challenge: string };

/** Constant-time string comparison, for MACs and tokens. */
export function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function mac(data: string): string {
    return createHmac('sha256', sessionSecret()).update(data).digest('base64url');
}

export function sign(payload: Signed): string {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${data}.${mac(data)}`;
}

export function verify<T extends Signed>(token: string | undefined, purpose: T['purpose']): T | null {
    if (!token) return null;
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    if (!safeEqual(mac(data), sig)) return null;
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as T;
        if (payload.purpose !== purpose || typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
        return payload;
    } catch {
        return null;
    }
}

const cookieOptions = (maxAge: number) => ({ httpOnly: true, secure: true, sameSite: 'strict' as const, path: '/', maxAge });
const now = () => Math.floor(Date.now() / 1000);

export function startSession(cookies: AstroCookies, credentialId: string) {
    const session: Session = { purpose: 'session', cred: credentialId, exp: now() + SESSION_SECONDS };
    cookies.set(SESSION_COOKIE, sign(session), cookieOptions(SESSION_SECONDS));
}

export function readSession(cookies: AstroCookies): Session | null {
    return verify<Session>(cookies.get(SESSION_COOKIE)?.value, 'session');
}

export function endSession(cookies: AstroCookies) {
    cookies.delete(SESSION_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'strict' });
}

export function setChallenge(cookies: AstroCookies, purpose: Challenge['purpose'], challenge: string) {
    const payload: Challenge = { purpose, challenge, exp: now() + CHALLENGE_SECONDS };
    cookies.set(CHALLENGE_COOKIE, sign(payload), cookieOptions(CHALLENGE_SECONDS));
}

/** One use: the cookie is cleared as it is read, so a challenge cannot be replayed. */
export function takeChallenge(cookies: AstroCookies, purpose: Challenge['purpose']): string | null {
    const payload = verify<Challenge>(cookies.get(CHALLENGE_COOKIE)?.value, purpose);
    cookies.delete(CHALLENGE_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'strict' });
    return payload?.challenge ?? null;
}
