/**
 * The vault page: which screen is showing, and everything the notes screen does.
 *
 * Flow: sign in with a passkey -> unlock with the master password (or create
 * the vault the first time) -> notes. Locking reloads the page, which is the
 * one sure way to drop the key and every decrypted note from memory.
 */
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import * as api from './api.ts';
import { prepareImage } from './images.ts';
import { render } from './markdown.ts';
import { Vault } from './vault.ts';
import {
    changePassword,
    createVault,
    parseHeader,
    randomId,
    resetPassword,
    rotateRecoveryKey,
    unlockWithPassword,
    WrongKeyError,
    type VaultHeader
} from '../lib/crypto.ts';
import { PATHS, type Note } from '../lib/model.ts';

const AUTO_LOCK_MS = 15 * 60 * 1000;
const SAVE_IDLE_MS = 2000;
// Keeps a long typing session under GitHub's limit on commits per hour.
const SAVE_MAX_WAIT_MS = 15000;
const RETRY_MS = 10000;
const MIN_PASSWORD = 12;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const decoder = new TextDecoder();

let vault: Vault | null = null;
let pending: { state: api.State; header?: VaultHeader; created?: { header: VaultHeader; key: CryptoKey } } | null = null;

/* ------------------------------------------------------------------------ */
/* Screens and messages                                                     */
/* ------------------------------------------------------------------------ */

type Screen = 'loading' | 'gate' | 'create' | 'recovery' | 'unlock' | 'app';

function show(screen: Screen) {
    document.querySelectorAll<HTMLElement>('[data-screen]').forEach((el) => (el.hidden = el.dataset.screen !== screen));
    const inApp = screen === 'app';
    $('#settings-open').hidden = !inApp;
    $('#lock').hidden = !inApp;
    $('#save-status').hidden = !inApp;
}

function say(name: string, message: string, ok = false) {
    const el = $(`[data-error="${name}"]`);
    el.textContent = message;
    el.toggleAttribute('data-ok', ok);
}

function describe(err: unknown): string {
    if (err instanceof WrongKeyError) return err.message === 'Wrong password or key' ? 'That is not the right password.' : err.message;
    if (err instanceof api.AuthError) return 'Signed out. Sign in again.';
    if (err instanceof DOMException && err.name === 'NotAllowedError') return 'Cancelled, or the passkey was not accepted.';
    if (err instanceof DOMException && err.name === 'InvalidStateError') return 'This device already has a passkey for the vault.';
    return err instanceof Error ? err.message : String(err);
}

/** Runs an action with its button disabled; reports failure in the named message line. */
async function act(button: HTMLButtonElement | null, errorName: string, fn: () => Promise<void>) {
    if (button?.disabled) return;
    if (button) button.disabled = true;
    say(errorName, '');
    try {
        await fn();
    } catch (err) {
        console.error(err);
        say(errorName, describe(err));
    } finally {
        if (button) button.disabled = false;
    }
}

function submitButton(form: HTMLFormElement) {
    return form.querySelector<HTMLButtonElement>('button[type="submit"]');
}

function checkNewPassword(password: string, confirm: string) {
    if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) throw new Error('The two passwords differ.');
}

function deviceName(): string {
    const ua = navigator.userAgent;
    for (const [re, name] of [
        [/iPhone/, 'iPhone'],
        [/iPad/, 'iPad'],
        [/Android/, 'Android'],
        [/Macintosh/, 'Mac'],
        [/Windows/, 'Windows'],
        [/Linux/, 'Linux']
    ] as const) {
        if (re.test(ua)) return name;
    }
    return 'Passkey';
}

/* ------------------------------------------------------------------------ */
/* Getting in                                                               */
/* ------------------------------------------------------------------------ */

async function boot() {
    show('loading');
    try {
        const status = await api.status();
        if (!status.signedIn) {
            $('#setup').hidden = status.hasPasskeys;
            show('gate');
            return;
        }
        const state = await api.state();
        const headerEntry = state.files[PATHS.header];
        if (!headerEntry) {
            pending = { state };
            show('create');
            $('#create-password').focus();
            return;
        }
        pending = { state, header: parseHeader(decoder.decode(await api.blob(headerEntry.sha))) };
        show('unlock');
        $('#unlock-password').focus();
    } catch (err) {
        console.error(err);
        show('gate');
        say('gate', describe(err));
    }
}

async function passkeySignIn() {
    if (!browserSupportsWebAuthn()) throw new Error('This browser does not support passkeys.');
    const options = await api.loginOptions();
    await api.login(await startAuthentication({ optionsJSON: options }));
}

$('#signin').addEventListener('click', (e) =>
    act(e.currentTarget as HTMLButtonElement, 'gate', async () => {
        await passkeySignIn();
        await boot();
    })
);

$<HTMLFormElement>('#setup').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    act(submitButton(form), 'gate', async () => {
        if (!browserSupportsWebAuthn()) throw new Error('This browser does not support passkeys.');
        const options = await api.registerOptions($<HTMLInputElement>('#setup-token').value.trim());
        await api.register(await startRegistration({ optionsJSON: options }), deviceName());
        await boot();
    });
});

$<HTMLFormElement>('#create-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    act(submitButton(form), 'create', async () => {
        const password = $<HTMLInputElement>('#create-password').value;
        checkNewPassword(password, $<HTMLInputElement>('#create-confirm').value);
        const { header, key, recoveryKey } = await createVault(password);
        pending = { ...pending!, created: { header, key } };
        form.reset();
        $('#recovery-key').textContent = recoveryKey;
        show('recovery');
    });
});

$('#recovery-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('#recovery-key').textContent ?? '');
    say('recovery', 'Copied. Paste it somewhere safe, then clear the clipboard.', true);
});

$('#recovery-download').addEventListener('click', () => {
    const text = `Recovery key for vault.egorthinks.com\n\n${$('#recovery-key').textContent}\n\nIt opens the vault if the master password is lost. Keep it away from the vault itself.\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'vault-recovery-key.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$<HTMLInputElement>('#recovery-saved').addEventListener('change', (e) => {
    $<HTMLButtonElement>('#recovery-done').disabled = !(e.currentTarget as HTMLInputElement).checked;
});

$('#recovery-done').addEventListener('click', (e) =>
    act(e.currentTarget as HTMLButtonElement, 'recovery', async () => {
        const { state, created } = pending!;
        const v = new Vault(created!.key, created!.header, state);
        await v.initialize();
        $('#recovery-key').textContent = '';
        enterApp(v);
    })
);

$<HTMLFormElement>('#unlock-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    act(submitButton(form), 'unlock', async () => {
        const { state, header } = pending!;
        const key = await unlockWithPassword(header!, $<HTMLInputElement>('#unlock-password').value);
        const v = new Vault(key, header!, state);
        await v.load();
        form.reset();
        enterApp(v);
    });
});

$('#show-reset').addEventListener('click', () => {
    $('#reset-form').hidden = false;
    $('#reset-key').focus();
});

$<HTMLFormElement>('#reset-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    act(submitButton(form), 'reset', async () => {
        const password = $<HTMLInputElement>('#reset-password').value;
        checkNewPassword(password, $<HTMLInputElement>('#reset-confirm').value);
        const { state, header } = pending!;
        const { header: next, key } = await resetPassword(header!, $<HTMLInputElement>('#reset-key').value, password);
        const v = new Vault(key, header!, state);
        await v.load();
        await v.saveHeader(next);
        form.reset();
        enterApp(v);
    });
});

document.querySelectorAll('[data-action="signout"]').forEach((el) =>
    el.addEventListener('click', async () => {
        await api.logout().catch(() => {});
        location.reload();
    })
);

/* ------------------------------------------------------------------------ */
/* Notes                                                                    */
/* ------------------------------------------------------------------------ */

const list = $<HTMLUListElement>('#note-list');
const search = $<HTMLInputElement>('#search');
const titleInput = $<HTMLInputElement>('#note-title');
const body = $<HTMLTextAreaElement>('#note-body');
const preview = $('#note-preview');
const appScreen = $('[data-screen="app"]');
const statusEl = $<HTMLButtonElement>('#save-status');

let current: Note | null = null;
let dirty = false;
let saving: Promise<void> | null = null;
let lastError: unknown = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let firstDirtyAt = 0;
let mode: 'write' | 'preview' = 'write';

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type SaveState = 'saved' | 'dirty' | 'saving' | 'uploading' | 'error';
const STATUS_LABEL: Record<SaveState, string> = { saved: 'Saved', dirty: 'Edited', saving: 'Saving', uploading: 'Uploading', error: 'Not saved' };

function setStatus(state: SaveState, label = STATUS_LABEL[state]) {
    statusEl.dataset.state = state;
    statusEl.querySelector('[data-label]')!.textContent = label;
    statusEl.disabled = state !== 'error';
    statusEl.title = state === 'error' ? 'Try again' : '';
}

function enterApp(v: Vault) {
    vault = v;
    pending = null;
    show('app');
    setStatus('saved');
    renderList();
}

function renderList() {
    if (!vault) return;
    const q = search.value.trim().toLowerCase();
    const notes = vault.listNotes().filter((n) => !q || `${n.title} ${n.excerpt}`.toLowerCase().includes(q));
    list.replaceChildren(
        ...notes.map((n) => {
            const li = document.createElement('li');
            const button = document.createElement('button');
            button.className = 'note-row hover:bg-muted border-main/25 w-full cursor-pointer border-b border-dashed px-3 py-3 text-left transition-colors';
            button.dataset.id = n.id;
            button.setAttribute('aria-current', String(n.id === current?.id));

            const title = document.createElement('span');
            title.className = 'block truncate font-serif text-lg leading-snug';
            title.textContent = n.title || 'Untitled';
            const excerpt = document.createElement('span');
            excerpt.className = 'text-main/60 mt-0.5 line-clamp-2 block text-sm';
            excerpt.textContent = n.excerpt;
            const date = document.createElement('span');
            date.className = 'eyebrow mt-2 block';
            date.textContent = dateFmt.format(new Date(n.updated));

            button.append(title, ...(n.excerpt ? [excerpt] : []), date);
            li.append(button);
            return li;
        })
    );
    const empty = $('#list-empty');
    empty.hidden = notes.length > 0;
    empty.textContent = q ? 'Nothing matches.' : 'Nothing here yet.';
}

function updateMeta() {
    if (!current) return;
    const saved = vault?.manifest.notes[current.id];
    $('#note-meta').textContent = saved
        ? `Created ${dateTimeFmt.format(new Date(current.created))} · edited ${dateTimeFmt.format(new Date(current.updated))}`
        : 'Not saved yet';
}

function setMode(next: 'write' | 'preview') {
    mode = next;
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === next)));
    body.hidden = next === 'preview';
    preview.hidden = next === 'write';
    if (next === 'preview') renderPreview();
}

async function renderPreview() {
    preview.innerHTML = render(body.value);
    for (const img of preview.querySelectorAll<HTMLImageElement>('img[data-vault]')) {
        vault
            ?.imageUrl(img.dataset.vault!)
            .then((url) => {
                if (url) img.src = url;
                else img.alt = `${img.alt} (missing)`;
            })
            .catch(() => (img.alt = `${img.alt} (could not decrypt)`));
    }
}

function showNote(note: Note | null) {
    current = note;
    $('#editor').hidden = !note;
    $('#note-empty').hidden = Boolean(note);
    appScreen.dataset.view = note ? 'note' : 'list';
    if (note) {
        titleInput.value = note.title;
        body.value = note.body;
        setMode(note.body ? mode : 'write');
        updateMeta();
    }
    list.querySelectorAll<HTMLElement>('.note-row').forEach((row) => row.setAttribute('aria-current', String(row.dataset.id === note?.id)));
}

/** Save what is open before going elsewhere. False if it could not be saved and the user chose to stay. */
async function leaveCurrent(): Promise<boolean> {
    await save();
    if (!dirty) return true;
    return confirm('The open note could not be saved. Leave it anyway and lose the latest changes?');
}

async function openNote(id: string) {
    if (!vault || id === current?.id) {
        if (id === current?.id) appScreen.dataset.view = 'note';
        return;
    }
    if (!(await leaveCurrent())) return;
    dirty = false;
    try {
        showNote(await vault.readNote(id));
        setStatus('saved');
    } catch (err) {
        setStatus('error', 'Could not open');
        lastError = err;
        console.error(err);
    }
}

async function newNote() {
    if (!vault || !(await leaveCurrent())) return;
    const now = new Date().toISOString();
    dirty = false;
    // Nothing is written until something is typed: an empty new note leaves no trace.
    showNote({ v: 1, id: randomId(), title: '', body: '', created: now, updated: now, files: [] });
    setMode('write');
    setStatus('saved', 'New');
    titleInput.focus();
}

function markDirty() {
    if (!current) return;
    current.title = titleInput.value;
    current.body = body.value;
    dirty = true;
    setStatus('dirty');
    clearTimeout(idleTimer);
    if (!firstDirtyAt) firstDirtyAt = Date.now();
    const wait = Math.min(SAVE_IDLE_MS, Math.max(0, firstDirtyAt + SAVE_MAX_WAIT_MS - Date.now()));
    idleTimer = setTimeout(() => void save(), wait);
}

async function save(): Promise<void> {
    clearTimeout(idleTimer);
    if (saving) {
        await saving;
        return dirty ? save() : undefined;
    }
    if (!dirty || !current || !vault) return;

    const snapshot: Note = { ...current, updated: new Date().toISOString() };
    dirty = false;
    firstDirtyAt = 0;
    setStatus('saving');
    saving = vault
        .saveNote(snapshot)
        .then(() => {
            lastError = null;
            if (current?.id === snapshot.id) current.updated = snapshot.updated;
            if (!dirty) setStatus('saved');
            renderList();
            updateMeta();
        })
        .catch((err) => {
            console.error(err);
            dirty = true;
            lastError = err;
            if (err instanceof api.AuthError) {
                setStatus('error', 'Sign in to save');
            } else {
                setStatus('error');
                idleTimer = setTimeout(() => void save(), RETRY_MS);
            }
        })
        .finally(() => {
            saving = null;
        });
    await saving;
}

statusEl.addEventListener('click', async () => {
    if (lastError instanceof api.AuthError) {
        try {
            await passkeySignIn();
        } catch (err) {
            setStatus('error', 'Sign in to save');
            console.error(err);
            return;
        }
    }
    lastError = null;
    await save();
});

async function deleteCurrent() {
    if (!vault || !current) return;
    const note = current;
    if (!confirm(`Delete “${note.title || 'Untitled'}”? It disappears from the vault; the encrypted copy stays in the repository's history.`)) return;
    clearTimeout(idleTimer);
    await saving;
    try {
        if (vault.manifest.notes[note.id]) {
            setStatus('saving', 'Deleting');
            await vault.deleteNote(note.id);
        }
        dirty = false;
        showNote(null);
        setStatus('saved');
        renderList();
    } catch (err) {
        console.error(err);
        lastError = err;
        setStatus('error', 'Not deleted');
    }
}

/* Images ------------------------------------------------------------------ */

async function addImages(files: File[]) {
    if (!vault || !current) return;
    const noteId = current.id;
    for (const file of files.filter((f) => f.type.startsWith('image/'))) {
        setStatus('uploading');
        let markdown = '';
        try {
            const image = await prepareImage(file);
            const id = randomId();
            const alt = image.name.replace(/\.[^.]+$/, '').replace(/[[\]()]/g, '') || 'image';
            markdown = `![${alt}](vault:${id})\n`;
            body.setRangeText(markdown, body.selectionStart, body.selectionEnd, 'end');
            markDirty();
            await vault.addFile(noteId, id, image.type, image.name, image.bytes);
            setStatus(dirty ? 'dirty' : 'saved');
            if (mode === 'preview') renderPreview();
        } catch (err) {
            console.error(err);
            if (markdown && current?.id === noteId) {
                body.value = body.value.replace(markdown, '');
                markDirty();
            }
            lastError = err;
            setStatus('error', 'Image not added');
        }
    }
}

body.addEventListener('paste', (e) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    addImages(files);
});

body.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});

body.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    addImages(files);
});

$('#attach').addEventListener('click', () => $<HTMLInputElement>('#attach-input').click());
$<HTMLInputElement>('#attach-input').addEventListener('change', (e) => {
    const input = e.currentTarget as HTMLInputElement;
    addImages(Array.from(input.files ?? []));
    input.value = '';
});

/* Wiring ------------------------------------------------------------------ */

list.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.note-row');
    if (row?.dataset.id) openNote(row.dataset.id);
});
search.addEventListener('input', renderList);
$('#new-note').addEventListener('click', newNote);
$('#back').addEventListener('click', async () => {
    await save();
    appScreen.dataset.view = 'list';
});
$('#delete-note').addEventListener('click', deleteCurrent);
titleInput.addEventListener('input', markDirty);
titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        body.focus();
    }
});
body.addEventListener('input', markDirty);
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as 'write' | 'preview')));

document.addEventListener('keydown', (e) => {
    if (!vault) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
    } else if (e.altKey && e.code === 'KeyN') {
        e.preventDefault();
        void newNote();
    }
});

// Coming back to the tab: pick up what other devices saved meanwhile.
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !vault || dirty || saving) return;
    try {
        const changed = await vault.refresh();
        renderList();
        if (!current || dirty) return;
        if (!vault.manifest.notes[current.id] && changed.includes(current.id)) showNote(null);
        else if (changed.includes(current.id)) showNote(await vault.readNote(current.id));
    } catch (err) {
        if (err instanceof api.AuthError) {
            lastError = err;
            setStatus('error', 'Sign in to save');
        }
    }
});

window.addEventListener('beforeunload', (e) => {
    if (dirty || saving) e.preventDefault();
});

/* Settings ---------------------------------------------------------------- */

const settings = $<HTMLDialogElement>('#settings');
$('#settings-open').addEventListener('click', () => settings.showModal());
$('[data-action="close-settings"]').addEventListener('click', () => settings.close());

$('#add-passkey').addEventListener('click', (e) =>
    act(e.currentTarget as HTMLButtonElement, 'passkey', async () => {
        const options = await api.registerOptions();
        await api.register(await startRegistration({ optionsJSON: options }), deviceName());
        say('passkey', 'Passkey added.', true);
    })
);

$<HTMLFormElement>('#password-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    act(submitButton(form), 'password', async () => {
        const next = $<HTMLInputElement>('#pw-new').value;
        checkNewPassword(next, $<HTMLInputElement>('#pw-confirm').value);
        await vault!.saveHeader(await changePassword(vault!.header, $<HTMLInputElement>('#pw-current').value, next));
        form.reset();
        say('password', 'Password changed. The old one no longer opens the vault.', true);
    });
});

$<HTMLFormElement>('#rotate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    act(submitButton(form), 'rotate', async () => {
        const { header, recoveryKey } = await rotateRecoveryKey(vault!.header, $<HTMLInputElement>('#rotate-password').value);
        await vault!.saveHeader(header);
        form.reset();
        say('rotate', `New recovery key: ${recoveryKey}. Store it now; it is not shown again.`, true);
    });
});

settings.addEventListener('close', () => {
    for (const name of ['passkey', 'password', 'rotate']) say(name, '');
});

/* Locking ----------------------------------------------------------------- */

async function lock() {
    try {
        await Promise.race([save(), new Promise((resolve) => setTimeout(resolve, 8000))]);
    } finally {
        vault = null;
        location.reload();
    }
}

$('#lock').addEventListener('click', lock);

let lastActivity = Date.now();
for (const type of ['keydown', 'pointerdown', 'input', 'wheel', 'touchstart']) {
    document.addEventListener(type, () => (lastActivity = Date.now()), { passive: true, capture: true });
}
// Checked on a timer, not scheduled once, because timers stall in background tabs.
setInterval(() => {
    if (vault && Date.now() - lastActivity > AUTO_LOCK_MS) void lock();
}, 30_000);

boot();
