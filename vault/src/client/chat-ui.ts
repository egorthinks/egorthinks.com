/**
 * The Chat tab. Talks to OpenRouter directly (openrouter.ts) and keeps history
 * through the vault (vault.ts), where every chat is sealed with its own
 * destroyable key (lib/chat.ts).
 *
 * Replies are rendered with the same sanitising markdown renderer as notes:
 * model output is untrusted text, and a reply that tries to load an image from
 * somewhere is exactly how a prompt injection would smuggle data out.
 */
import { render } from './markdown.ts';
import { OpenRouterError, streamChat, zdrModels, type Model } from './openrouter.ts';
import type { Vault } from './vault.ts';
import { titleFrom, type Chat, type ChatMeta } from '../lib/chat.ts';
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
                group.append(new Option(`${m.name} · $${perMillion(m.prompt)} / $${perMillion(m.completion)} per M`, m.id, false, m.id === chosen));
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

    function messageNode(m: Chat['messages'][number]): HTMLElement {
        if (m.role === 'user') {
            const el = document.createElement('div');
            el.className = 'chat-user border-main/45 max-w-[85%] self-end rounded-[1.25rem] border border-dashed px-4 py-2.5 text-[0.95rem] leading-relaxed';
            el.textContent = m.content;
            return el;
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

    function reset() {
        streaming?.abort();
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
        if (!v || !key || !chat || streaming || !text.trim()) return;
        const model = modelSelect.value;
        if (!model) return ctx.say('chat', 'Pick a model first.');
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
            meta = { title: titleFrom(text), model, created: now, updated: now };
        }
        chat.messages.push({ role: 'user', content: text, at: now });
        input.value = '';
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
                // Only what was said; failed turns and metadata stay home.
                messages: chat.messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
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
        }
        renderMessages();

        meta = { ...meta!, model, updated: new Date().toISOString() };
        ctx.setStatus('saving');
        try {
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
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            void send(input.value);
        }
    });
    stopButton.addEventListener('click', () => streaming?.abort());

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
