/**
 * Server configuration, read from the environment.
 *
 *   VAULT_ORIGIN           https://vault.egorthinks.com (required in production;
 *                          passkeys are bound to its host name)
 *   VAULT_SESSION_SECRET   32+ random bytes, signs session cookies
 *   VAULT_SETUP_TOKEN      lets the first passkey register; remove once you have one
 *   VAULT_GITHUB_REPO      owner/name of the private data repository
 *   VAULT_GITHUB_TOKEN     fine-grained token: Contents read/write on that repo only
 *   VAULT_GITHUB_BRANCH    default main
 *   VAULT_STORAGE=fs       local development only: keep data in VAULT_FS_DIR
 */

export function env(name: string): string | undefined {
    // Vercel puts secrets in process.env; `astro dev` reads .env into import.meta.env.
    return process.env[name] || (import.meta.env?.[name] as string | undefined) || undefined;
}

export function origin(requestUrl: URL): string {
    const configured = env('VAULT_ORIGIN');
    if (configured) return configured.replace(/\/$/, '');
    if (import.meta.env.DEV) return requestUrl.origin;
    throw new Error('VAULT_ORIGIN must be set');
}

export function rpID(requestUrl: URL): string {
    return new URL(origin(requestUrl)).hostname;
}

export function sessionSecret(): string {
    const secret = env('VAULT_SESSION_SECRET');
    if (!secret || secret.length < 32) throw new Error('VAULT_SESSION_SECRET must be at least 32 characters');
    return secret;
}
