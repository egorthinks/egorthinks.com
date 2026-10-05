# Vault

A private, end-to-end encrypted notebook at `vault.egorthinks.com`. Markdown notes, images, and stored documents (pdf, xlsx, docx, anything), encrypted in the browser before
they leave it, stored as ciphertext in a private GitHub repository. The server signs you in and moves bytes; it never sees a password, a key, or a word of a
note.

It lives in this repository so it can share the site's design system (`../src/styles/design-system.css`), but it is a separate Astro app with its own
dependencies, its own Vercel project and its own origin. Nothing the blog builds or runs can reach it.

## How it is put together

```
browser                                          Vercel function                 GitHub (private repo)
───────                                          ───────────────                 ─────────────────────
passkey (Face ID / fingerprint) ──────────────▶  verifies, sets session cookie
master password ─Argon2id─▶ KEK ─▶ vault key
note ─AES-256-GCM─▶ ciphertext ───────────────▶  checks session, refuses   ──▶   one commit per save
                                                 anything that isn't sealed
```

- **Two locks.** The passkey decides who may fetch ciphertext. The master password decides who can read it. Either alone gets nothing.
- **Keys.** A random 256-bit vault key encrypts everything. It is stored twice in `vault.json`: wrapped by a key derived from the master password with
  Argon2id (64 MiB, 3 passes), and wrapped by the recovery key. Changing the password rewraps one key, not every note.
- **Objects.** `EGV1 | 12-byte nonce | AES-256-GCM ciphertext+tag`, with the object's path as associated data, so ciphertext cannot be moved from one note
  to another, or onto the manifest, without failing to decrypt.
- **Names carry nothing.** Notes are `notes/<random id>.md.enc`; titles and document names live inside the ciphertext and in the encrypted manifest.
  Commit messages are just "Save". What leaks: how many notes and documents there are, roughly how long, and when they changed.
- **Documents.** The Files tab stores any file, whole, up to 50 MB: add, download, delete, never edit. A document is cut into 3 MiB pieces
  (`docs/<id>/<n>.enc`) because a save has to fit a Vercel request; each piece is sealed with its path as associated data, and the first one carries the
  name, type, size and piece count, so a missing, extra, reordered or swapped piece is detected, here and in the offline decryptor. Downloads are saved
  as-is, never rendered by the page. Git keeps every version of every file forever, so deleting a document removes it from the vault but not from the
  repository's history; keep large files out unless you want them there for good.
- **Storage.** Every save is one atomic commit (GraphQL `createCommitOnBranch`), applied only if nobody else committed since this browser last looked.
  Otherwise the browser re-reads and retries, so two devices editing different notes never lose anything. History is git history.
- **The page.** Strict CSP (scripts, styles, fonts and connections from this origin only; images from this origin or decrypted `blob:` URLs), no inline
  script or style, no third-party anything. Markdown is sanitised with DOMPurify, and remote images are never loaded. Auto-lock after 15 minutes idle;
  locking reloads the page, which drops the key and every decrypted note.

The code to read first: [`src/lib/crypto.ts`](src/lib/crypto.ts) (all of the cryptography), then [`src/client/vault.ts`](src/client/vault.ts) (what is
read and written), then [`src/middleware.ts`](src/middleware.ts) (what the server enforces).

## Deploying

1. **Data repository.** Create a private repository, for example `egorthinks/vault-data`. Empty is fine; the vault writes its own README on the first
   save.

2. **GitHub token.** Settings → Developer settings → Fine-grained tokens → Generate. Repository access: _Only select repositories_ → the data repository.
   Permissions: _Contents: Read and write_ (Metadata: read is added automatically). Nothing else. Put a reminder in your calendar for when it expires.

3. **Vercel project.** Add New → Project → import `egorthinks/egorthinks.com` again (a second project next to the blog). Set **Root Directory** to
   `vault` and keep "Include files outside the root directory" on (the default), since the styles come from `../src/styles`. Framework: Astro.

4. **Environment variables**, scoped to **Production only**, so preview deployments get no token:

    | Name                   | Value                                                                                  |
    | ---------------------- | -------------------------------------------------------------------------------------- |
    | `VAULT_ORIGIN`         | `https://vault.egorthinks.com`                                                         |
    | `VAULT_GITHUB_REPO`    | `egorthinks/vault-data`                                                                |
    | `VAULT_GITHUB_TOKEN`   | the token from step 2                                                                  |
    | `VAULT_SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`       |
    | `VAULT_SETUP_TOKEN`    | another random value, as above                                                         |

5. **Domain.** Project → Settings → Domains → add `vault.egorthinks.com`. If the DNS for egorthinks.com is not on Vercel, add the CNAME it asks for.

6. **First visit.** Open the vault, enter the setup token, register a passkey, choose a master password, store the recovery key. Then delete
   `VAULT_SETUP_TOKEN` from Vercel. (It stops working anyway once a passkey exists, but there is no reason to keep it.)

7. **More devices.** A passkey saved to Google Password Manager or iCloud Keychain syncs to that account's other devices; one saved only on the computer
   (Touch ID, Windows Hello, "Chrome profile") does not. To give a phone its own passkey, sign in on a computer, open Settings → Add a passkey, and in
   the browser's dialog choose **"Use a phone or tablet"**: scan the QR code with the phone (Bluetooth on) and the phone saves the passkey. Adding a
   passkey has to start from a signed-in browser, so it cannot be done on the new device itself.

Optional but worth it: Settings → Deployment Protection → Vercel Authentication for preview deployments, and two-factor authentication on GitHub and
Vercel, which matters more than any cipher here (see below).

## If something goes wrong

- **Forgot the master password.** Unlock screen → "Use the recovery key". It sets a new password.
- **Lost a device.** Delete its entry from `.vault/passkeys.json` in the data repository, then change `VAULT_SESSION_SECRET` in Vercel to end every
  open session. The notes on that device were encrypted, and it held no key once locked.
- **The site is gone.** Clone the data repository and run `npm install && npm run decrypt -- <clone> <output-dir>` here. You get plain `.md` files,
  the images, and the documents under their own names, no network involved. A document with a missing piece is refused rather than written short.
- **Same note edited on two devices at once.** The later save wins; the earlier version is still in the data repository's git history.

## The honest weak spot

Code that encrypts in a web page is delivered by the same server it protects you from. Someone who could change what this site serves (through the
GitHub account, the Vercel account, or a compromised npm package in this folder) could ship a page that reads the password as it is typed. The
defences are the ones above: a separate origin, a strict CSP, very few dependencies (`hash-wasm`, `marked`, `dompurify`, `@simplewebauthn/*`), and
2FA on the accounts that can deploy. The data at rest is safe against everything short of that.

## Developing

```bash
cd vault
npm install
cp .env.example .env   # fill VAULT_SESSION_SECRET and VAULT_SETUP_TOKEN; VAULT_STORAGE=fs keeps data in ./.vault-data
npm run dev            # http://localhost:4321
npm test               # cryptography, sessions, storage
npx astro check
```

Passkeys work on `localhost` in Chrome, Safari and Firefox. Node 22.18 or newer runs the TypeScript tests and the decrypt script directly.
