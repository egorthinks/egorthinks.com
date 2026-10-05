/**
 * The Chat tab. Talks to OpenRouter directly (openrouter.ts) and keeps history
 * through the vault (vault.ts), where every chat is sealed with its own
 * destroyable key (lib/chat.ts).
 *
 * Replies are rendered with the same sanitising markdown renderer as notes:
 * model output is untrusted text, and a reply that tries to load an image from
 * somewhere is exactly how a prompt injection would smuggle data out.
 */
import { prepareForModel } from './images.ts';
import { render } from './markdown.ts';
import { OpenRouterError, streamChat, zdrModels, type Model, type Part, type Turn } from './openrouter.ts';
import type { Vault } from './vault.ts';
import { MAX_CHAT_IMAGES, titleFrom, type Chat, type ChatMeta } from '../lib/chat.ts';
import { randomId, toBase64, type Bytes } from '../lib/crypto.ts';
import type { Settings } from '../lib/model.ts';

type StatusState = 'saved' | 'dirty' | 'saving' | 'uploading' | 'error';

export type ChatContext = {
    vault: () => Vault | null;
    setStatus: (state: StatusState, label?: string) => void;
    /** Put the status pill back to whatever the notes say. */
    idleStatus: () => void;
    say: (name: string, message: string, ok?: boolean) => void;
    describe: (err: unknown) => string;
    /** Counts as activity for auto-lock (a long reply is activity). */
    touch: () => void;
};

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const DAY = 86400;

export function initChat(ctx: ChatContext) {
    const view = $('#chat-view');
    const list = $<HTMLUListElement>('#chat-list');
    const messagesEl = $('#chat-messages');
    const input = $<HTMLTextAreaElement>('#chat-input');
    const modelSelect = $<HTMLSelectElement>('#chat-model');
    const expirySelect = $<HTMLSelectElement>('#chat-expiry');
    const sendButton = $<HTMLButtonElement>('#chat-send');
    const stopButton = $<HTMLButtonElement>('#chat-stop');
    const attachments = $('#chat-attachments');
    const photoInput = $<HTMLInputElement>('#chat-photo-input');
    const composer = $('#chat-form');

    /** Photos chosen for the next message, already shrunk and stripped of metadata. */
    let pending: { id: string; type: string; bytes: Bytes; url: string }[] = [];
    /** Photos this tab has seen, by chat/image id: bytes to resend, URLs to show. */
    const localImages = new Map<string, { type: string; bytes: Bytes }>();
    const imageUrls = new Map<string, string>();

    const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
    const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

    let settings: Settings | null = null;
    let models: Model[] | null = null;
    let loaded: Promise<void> | null = null;
    /** Set by a panic unlock: no chat may load until the burn has gone through. */
    let burning: Promise<void> | null = null;

    let chatId: string | null = null;
    let chat: Chat | null = null;
    let meta: ChatMeta | null = null;
    let draftExpiryDays: number | null = null;
    let streaming: AbortController | null = null;

    /* Loading ---------------------------------------------------------------- */

    async function burnUntilDone(v: Vault) {
        for (;;) {
            try {
                await v.burnChats();
                return;
            } catch {
                await new Promise((r) => setTimeout(r, 5000));
            }
        }
    }

    function load(): Promise<void> {
        const v = ctx.vault();
        if (!v) return Promise.resolve();
        loaded ??= (async () => {
            if (burning) await burning;
            settings = await v.readSettings();
            await v.loadChats();
            await v.expireChats();
        })().catch((err) => {
            loaded = null;
            throw err;
        });
        return loaded;
    }

    async function loadModels(): Promise<void> {
        if (models || !settings?.openrouterKey) return;
        models = await zdrModels(settings.openrouterKey);
        fillModels();
    }

    function fillModels() {
        const chosen = meta?.model ?? settings?.lastModel ?? '';
        const groups = new Map<string, Model[]>();
        for (const m of models ?? []) {
            const author = m.id.split('/')[0];
            groups.set(author, [...(groups.get(author) ?? []), m]);
        }
        const perMillion = (n: number) => (n * 1e6 < 0.01 ? (n * 1e6).toFixed(3) : (n * 1e6).toFixed(2));
        const nodes: HTMLElement[] = [];
        if (chosen && !(models ?? []).some((m) => m.id === chosen)) {
            const gone = new Option(`${chosen} (no zero-retention provider now)`, chosen, false, true);
            gone.disabled = true;
            nodes.push(gone);
        }
        for (const [author, ms] of groups) {
            const group = document.createElement('optgroup');
            group.label = author;
            for (const m of ms) {
                const label = `${m.name}${m.vision ? ' · sees images' : ''} · $${perMillion(m.prompt)} / $${perMillion(m.completion)} per M`;
                group.append(new Option(label, m.id, false, m.id === chosen));
            }
            nodes.push(group);
        }
        modelSelect.replaceChildren(...nodes);
        if (!modelSelect.value && models?.length) modelSelect.value = models[0].id;
    }

    /* Rendering -------------------------------------------------------------- */

    function renderList() {
        const v = ctx.vault();
        if (!v) return;
        const chats = v.listChats();
        list.replaceChildren(
            ...chats.map((c) => {
                const li = document.createElement('li');
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'note-row hover:bg-muted border-main/25 w-full cursor-pointer border-b border-dashed px-3 py-3 text-left transition-colors';
                row.dataset.id = c.id;
                row.setAttribute('aria-current', String(c.id === chatId));
                const title = document.createElement('span');
                title.className = 'block truncate font-serif text-lg leading-snug';
                title.textContent = c.title;
                const sub = document.createElement('span');
                sub.className = 'eyebrow mt-2 block';
                sub.textContent = [dateFmt.format(new Date(c.updated)), c.expires ? `deletes ${dateFmt.format(new Date(c.expires * 1000))}` : '']
                    .filter(Boolean)
                    .join(' · ');
                row.append(title, sub);
                li.append(row);
                return li;
            })
        );
        $('#chat-list-empty').hidden = chats.length > 0;
    }

    /** A decrypted photo as a blob: URL, made once. */
    async function imageUrl(cid: string, imageId: string): Promise<string> {
        const k = `${cid}/${imageId}`;
        const known = imageUrls.get(k);
        if (known) return known;
        const v = ctx.vault();
        const image = localImages.get(k) ?? (await v!.readChatImage(cid, imageId));
        const url = URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: image.type }));
        imageUrls.set(k, url);
        return url;
    }

    function messageNode(m: Chat['messages'][number]): HTMLElement {
        if (m.role === 'user') {
            const wrap = document.createElement('div');
            wrap.className = 'flex max-w-[85%] flex-col items-end gap-2 self-end';
            if (m.images?.length && chatId) {
                const row = document.createElement('div');
                row.className = 'flex flex-wrap justify-end gap-2';
                for (const imageId of m.images) {
                    const img = document.createElement('img');
                    img.className = 'chat-photo';
                    img.alt = 'Attached photo';
                    const cid = chatId;
                    imageUrl(cid, imageId)
                        .then((url) => (img.src = url))
                        .catch(() => (img.alt = 'Photo unavailable'));
                    row.append(img);
                }
                wrap.append(row);
            }
            if (m.content) {
                const el = document.createElement('div');
                el.className = 'chat-user border-main/45 rounded-[1.25rem] border border-dashed px-4 py-2.5 text-[0.95rem] leading-relaxed';
                el.textContent = m.content;
                wrap.append(el);
            }
            return wrap;
        }
        const wrap = document.createElement('div');
        wrap.className = 'min-w-0';
        const body = document.createElement('div');
        body.className = 'prose max-w-none';
        body.innerHTML = render(m.content);
        wrap.append(body);
        if (m.error) {
            const err = document.createElement('p');
            err.className = 'error-line mt-2';
            err.textContent = m.error;
            wrap.append(err);
        }
        const bits = [
            m.model?.split('/').pop(),
            m.usage ? `${m.usage.completion} tokens` : '',
            m.usage?.cost !== undefined ? `$${m.usage.cost >= 0.01 ? m.usage.cost.toFixed(2) : m.usage.cost.toPrecision(2)}` : ''
        ];
        if (bits.some(Boolean)) {
            const info = document.createElement('span');
            info.className = 'eyebrow mt-2 block';
            info.textContent = bits.filter(Boolean).join(' · ');
            wrap.append(info);
        }
        return wrap;
    }

    function renderMessages() {
        messagesEl.replaceChildren(...(chat?.messages ?? []).map(messageNode));
    }

    /** The sentence under the controls. The select itself is set where the choice is made. */
    function renderExpiry() {
        const v = ctx.vault();
        const expires = chatId && v ? v.chatExpiry(chatId) : null;
        const days = chatId ? null : draftExpiryDays;
        $('#chat-expiry-note').textContent = expires
            ? `Deletes itself ${dateTimeFmt.format(new Date(expires * 1000))}, for good: its key is destroyed.`
            : days
              ? `Will delete itself ${days} day${days === 1 ? '' : 's'} after the first message.`
              : '';
    }

    /** Which screen of the tab: setup (no key), empty, or a chat. */
    function showPane() {
        const hasKey = Boolean(settings?.openrouterKey);
        $('#chat-setup').hidden = hasKey;
        $('#chat-list-pane').hidden = !hasKey;
        // Without a key there is no list, and the setup card gets the whole width.
        view.classList.toggle('md:grid-cols-[18rem_1fr]', hasKey);
        $('#chat-empty').hidden = !hasKey || chat !== null;
        $('#chat-main').hidden = !hasKey || chat === null;
        view.dataset.view = chat ? 'note' : 'list';
        list.querySelectorAll<HTMLElement>('.note-row').forEach((r) => r.setAttribute('aria-current', String(r.dataset.id === chatId)));
    }

    function renderAttachments() {
        attachments.hidden = pending.length === 0;
        updateSend();
        queueMicrotask(autosize);
        attachments.replaceChildren(
            ...pending.map((p) => {
                const box = document.createElement('div');
                box.className = 'relative';
                const img = document.createElement('img');
                img.className = 'chat-thumb';
                img.src = p.url;
                img.alt = 'Photo to send';
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'chat-thumb-remove';
                remove.textContent = '×';
                remove.setAttribute('aria-label', 'Remove photo');
                remove.addEventListener('click', () => {
                    URL.revokeObjectURL(p.url);
                    pending = pending.filter((x) => x !== p);
                    renderAttachments();
                });
                box.append(img, remove);
                return box;
            })
        );
    }

    /** Grow with the text, up to the CSS max-height; past it, scroll. */
    function autosize() {
        input.style.height = 'auto';
        const max = parseFloat(getComputedStyle(input).maxHeight) || 256;
        const height = Math.min(input.scrollHeight, max);
        input.style.height = `${height}px`;
        input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden';
        // One line: a pill. More: a rounded box, so the corners do not eat the text.
        composer.style.borderRadius = height > 48 || pending.length ? '1.25rem' : '';
    }

    function updateSend() {
        sendButton.disabled = !input.value.trim() && pending.length === 0;
    }

    function clearPending() {
        for (const p of pending) URL.revokeObjectURL(p.url);
        pending = [];
        renderAttachments();
    }

    function selectedModel(): Model | undefined {
        return models?.find((m) => m.id === modelSelect.value);
    }

    async function addPhotos(files: File[]) {
        const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
        if (!images.length || !chat) return;
        ctx.say('chat', '');
        if (selectedModel() && !selectedModel()!.vision) ctx.say('chat', 'This model cannot see images. Pick one marked “sees images” before sending.');
        for (const file of images) {
            if (pending.length >= MAX_CHAT_IMAGES) {
                ctx.say('chat', `Up to ${MAX_CHAT_IMAGES} photos per message.`);
                break;
            }
            try {
                ctx.setStatus('uploading', 'Preparing photo');
                const { bytes, type } = await prepareForModel(file);
                pending.push({ id: randomId(), type, bytes, url: URL.createObjectURL(new Blob([bytes as BlobPart], { type })) });
                renderAttachments();
            } catch (err) {
                ctx.say('chat', ctx.describe(err));
            }
        }
        ctx.idleStatus();
        input.focus();
    }

    /** What OpenRouter receives: each turn's text, and its photos when the model can see them. */
    async function turnsFor(c: Chat, vision: boolean): Promise<Turn[]> {
        const turns: Turn[] = [];
        for (const m of c.messages) {
            if (m.error) continue;
            if (m.role !== 'user' || !m.images?.length) {
                turns.push({ role: m.role, content: m.content });
                continue;
            }
            if (!vision) {
                turns.push({ role: 'user', content: m.content || '[a photo the current model cannot see]' });
                continue;
            }
            const parts: Part[] = m.content ? [{ type: 'text', text: m.content }] : [];
            for (const imageId of m.images) {
                const k = `${c.id}/${imageId}`;
                const image = localImages.get(k) ?? (await ctx.vault()!.readChatImage(c.id, imageId));
                parts.push({ type: 'image_url', image_url: { url: `data:${image.type};base64,${toBase64(image.bytes)}` } });
            }
            turns.push({ role: 'user', content: parts });
        }
        return turns;
    }

    function reset() {
        streaming?.abort();
        clearPending();
        chatId = null;
        chat = null;
        meta = null;
        draftExpiryDays = null;
        messagesEl.replaceChildren();
        showPane();
    }

    /* Actions ---------------------------------------------------------------- */

    async function show() {
        ctx.say('chat', '');
        try {
            await load();
        } catch (err) {
            ctx.say('chat', ctx.describe(err));
        }
        renderList();
        showPane();
        try {
            await loadModels();
        } catch (err) {
            ctx.say(settings?.openrouterKey ? 'chat' : 'chat-setup', ctx.describe(err));
        }
    }

    async function openChat(id: string) {
        const v = ctx.vault();
        if (!v || streaming) return;
        ctx.say('chat', '');
        clearPending();
        try {
            chat = await v.readChat(id);
            chatId = id;
            meta = v.chatMeta.get(id) ?? null;
            expirySelect.value = '';
            const expires = v.chatExpiry(id);
            if (expires) {
                // Show the nearest preset; the note underneath gives the exact moment.
                const left = (expires - Date.now() / 1000) / DAY;
                expirySelect.value = left <= 1 ? '1' : left <= 7 ? '7' : '30';
            }
            fillModels();
            renderMessages();
            renderExpiry();
            showPane();
        } catch (err) {
            ctx.say('chat', ctx.describe(err));
        }
    }

    function newChat() {
        if (streaming) return;
        chatId = null;
        meta = null;
        draftExpiryDays = null;
        expirySelect.value = '';
        clearPending();
        chat = { v: 1, id: '', messages: [] };
        fillModels();
        renderMessages();
        renderExpiry();
        showPane();
        input.focus();
    }

    async function send(text: string) {
        const v = ctx.vault();
        const key = settings?.openrouterKey;
        if (!v || !key || !chat || streaming || (!text.trim() && !pending.length)) return;
        const model = modelSelect.value;
        if (!model) return ctx.say('chat', 'Pick a model first.');
        const vision = selectedModel()?.vision ?? false;
        if (pending.length && !vision) return ctx.say('chat', 'This model cannot see images. Pick one marked “sees images”, or remove the photos.');
        ctx.say('chat', '');

        const now = new Date().toISOString();
        if (!chatId) {
            // The key exists in Blob before a single byte is sealed with it.
            const expires = draftExpiryDays ? Math.floor(Date.now() / 1000) + draftExpiryDays * DAY : null;
            try {
                chatId = await v.createChat(expires);
            } catch (err) {
                return ctx.say('chat', ctx.describe(err));
            }
            chat = { v: 1, id: chatId, messages: [] };
            meta = { title: titleFrom(text || 'Photo'), model, created: now, updated: now };
        }
        const photos = pending;
        pending = [];
        renderAttachments();
        for (const p of photos) {
            localImages.set(`${chatId}/${p.id}`, { type: p.type, bytes: p.bytes });
            imageUrls.set(`${chatId}/${p.id}`, p.url);
        }
        chat.messages.push({ role: 'user', content: text, at: now, ...(photos.length ? { images: photos.map((p) => p.id) } : {}) });
        input.value = '';
        autosize();
        updateSend();
        renderMessages();

        const reply = document.createElement('div');
        reply.className = 'prose max-w-none';
        messagesEl.append(reply);
        let partial = '';
        let frame = 0;

        streaming = new AbortController();
        sendButton.hidden = true;
        stopButton.hidden = false;
        ctx.setStatus('uploading', 'Thinking');
        try {
            const result = await streamChat({
                key,
                model,
                // Only what was said (and shown); failed turns and metadata stay home.
                messages: await turnsFor(chat, vision),
                signal: streaming.signal,
                onDelta: (piece) => {
                    partial += piece;
                    ctx.touch();
                    cancelAnimationFrame(frame);
                    frame = requestAnimationFrame(() => (reply.innerHTML = render(partial)));
                }
            });
            chat.messages.push({
                role: 'assistant',
                content: result.content,
                at: new Date().toISOString(),
                model: result.model,
                usage: result.usage,
                ...(result.stopped ? { error: 'Stopped.' } : {})
            });
        } catch (err) {
            const message = err instanceof OpenRouterError || err instanceof Error ? err.message : String(err);
            chat.messages.push({ role: 'assistant', content: partial, at: new Date().toISOString(), model, error: message });
        } finally {
            cancelAnimationFrame(frame);
            streaming = null;
            sendButton.hidden = false;
            stopButton.hidden = true;
            updateSend();
        }
        renderMessages();

        meta = { ...meta!, model, updated: new Date().toISOString() };
        ctx.setStatus('saving');
        try {
            // Photos first, one commit each, sealed with this chat's key; then the chat that refers to them.
            for (const p of photos) await v.saveChatImage(chatId!, p.id, p.type, p.bytes);
            await v.saveChat(chat, meta);
            if (settings && settings.lastModel !== model) {
                settings = { ...settings, lastModel: model };
                await v.saveSettings(settings);
            }
            ctx.idleStatus();
        } catch (err) {
            ctx.setStatus('error', 'Chat not saved');
            ctx.say('chat', ctx.describe(err));
        }
        renderList();
        renderExpiry();
        showPane();
    }

    async function saveKey(key: string, errorName: string) {
        const v = ctx.vault();
        if (!v) return;
        key = key.trim();
        if (!/^sk-or-[A-Za-z0-9_-]{10,}$/.test(key)) throw new Error('That does not look like an OpenRouter key (sk-or-…).');
        // Try it before keeping it: a typo is better caught now than mid-conversation.
        const list = await zdrModels(key);
        settings = { ...(settings ?? { v: 1 }), openrouterKey: key };
        await v.saveSettings(settings);
        models = list;
        fillModels();
        ctx.say(errorName, `Key saved. ${list.length} models have zero-retention providers.`, true);
    }

    /* Wiring ----------------------------------------------------------------- */

    $('#chat-new').addEventListener('click', newChat);
    $('#chat-back').addEventListener('click', () => (view.dataset.view = 'list'));
    list.addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('.note-row');
        if (row?.dataset.id) void openChat(row.dataset.id);
    });

    $<HTMLFormElement>('#chat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        void send(input.value);
    });
    // On a phone, Return is for new lines and the arrow button sends; on a keyboard, Enter sends.
    const touchFirst = window.matchMedia('(pointer: coarse)').matches;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !touchFirst) {
            e.preventDefault();
            void send(input.value);
        }
    });
    input.addEventListener('input', () => {
        autosize();
        updateSend();
    });
    window.addEventListener('resize', () => autosize());
    stopButton.addEventListener('click', () => streaming?.abort());

    // A warning about photos belongs to the model it was about.
    modelSelect.addEventListener('change', () => {
        const model = selectedModel();
        ctx.say('chat', pending.length && model && !model.vision ? 'This model cannot see images. Pick one marked “sees images” before sending.' : '');
    });

    $('#chat-attach').addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', () => {
        void addPhotos(Array.from(photoInput.files ?? []));
        photoInput.value = '';
    });
    input.addEventListener('paste', (e) => {
        const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return;
        e.preventDefault();
        void addPhotos(files);
    });
    composer.addEventListener('dragover', (e) => {
        if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    composer.addEventListener('drop', (e) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (!files.length) return;
        e.preventDefault();
        void addPhotos(files);
    });

    expirySelect.addEventListener('change', async () => {
        const days = expirySelect.value ? Number(expirySelect.value) : null;
        const v = ctx.vault();
        if (!chatId || !v) {
            draftExpiryDays = days;
            return renderExpiry();
        }
        try {
            await v.setChatExpiry(chatId, days ? Math.floor(Date.now() / 1000) + days * DAY : null);
            renderExpiry();
            renderList();
        } catch (err) {
            ctx.say('chat', ctx.describe(err));
        }
    });

    $('#chat-delete').addEventListener('click', async () => {
        const v = ctx.vault();
        if (!v || !chat || streaming) return;
        if (!chatId) return reset();
        if (!confirm(`Delete “${meta?.title ?? 'this chat'}”? Its key is destroyed: it cannot be recovered, not even from the repository's history.`)) return;
        try {
            ctx.setStatus('saving', 'Deleting');
            await v.deleteChat(chatId);
            ctx.idleStatus();
            reset();
            renderList();
        } catch (err) {
            ctx.setStatus('error', 'Not deleted');
            ctx.say('chat', ctx.describe(err));
        }
    });

    $<HTMLFormElement>('#chat-setup').addEventListener('submit', async (e) => {
        e.preventDefault();
        const button = (e.currentTarget as HTMLFormElement).querySelector<HTMLButtonElement>('button[type="submit"]')!;
        button.disabled = true;
        ctx.say('chat-setup', '');
        try {
            await saveKey($<HTMLInputElement>('#chat-key').value, 'chat-setup');
            $<HTMLInputElement>('#chat-key').value = '';
            renderList();
            showPane();
        } catch (err) {
            ctx.say('chat-setup', ctx.describe(err));
        } finally {
            button.disabled = false;
        }
    });

    $<HTMLFormElement>('#chat-key-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        ctx.say('chat-key', '');
        try {
            await load();
            await saveKey($<HTMLInputElement>('#settings-chat-key').value, 'chat-key');
            $<HTMLInputElement>('#settings-chat-key').value = '';
            showPane();
        } catch (err) {
            ctx.say('chat-key', ctx.describe(err));
        }
    });

    $('#burn-chats').addEventListener('click', async () => {
        const v = ctx.vault();
        if (!v) return;
        if (!confirm('Burn every chat? Their keys are destroyed and nothing can bring them back.')) return;
        ctx.say('burn', '');
        try {
            const n = await v.burnChats();
            reset();
            renderList();
            ctx.say('burn', `Burned. ${n} chat key${n === 1 ? '' : 's'} destroyed.`, true);
        } catch (err) {
            ctx.say('burn', ctx.describe(err));
        }
    });

    // Expiry is enforced by the server too (on every listing, and daily); this just makes it visible at once.
    setInterval(async () => {
        const v = ctx.vault();
        if (!v || streaming || !loaded) return;
        try {
            const gone = await v.expireChats();
            if (chatId && gone.includes(chatId)) reset();
            if (gone.length) renderList();
        } catch {}
    }, 60_000);

    return {
        /**
         * After unlock. With `panic`, every chat is destroyed before anything of
         * them can load: the first attempt is awaited (one request, unnoticeable),
         * and if it fails it keeps retrying in the background while the Chat tab
         * stays empty.
         */
        async enter(options: { panic: boolean }) {
            loaded = null;
            burning = null;
            const v = ctx.vault();
            if (!options.panic || !v) return;
            try {
                await v.burnChats();
            } catch {
                burning = burnUntilDone(v).then(() => void (burning = null));
            }
        },
        show,
        /** Another device may have added or deleted chats. */
        async refresh() {
            const v = ctx.vault();
            if (!v || streaming || !loaded) return;
            await v.loadChats();
            if (chatId && !v.chatMeta.has(chatId)) reset();
            renderList();
        },
        busy: () => streaming !== null
    };
}
