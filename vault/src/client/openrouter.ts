/**
 * OpenRouter, called straight from the browser: prompts never pass through the
 * vault's server. Every request demands zero data retention and no data
 * collection; the account and the key's guardrail should demand it too, so a
 * bug here alone cannot route a prompt to a provider that keeps it.
 *
 * Deliberately absent: plugins, web search, tools, file parsing. ZDR does not
 * cover them (OpenRouter says so), and a model that can act is a model that a
 * pasted prompt injection can make act.
 */
const BASE = 'https://openrouter.ai/api/v1';

export type Model = { id: string; name: string; context: number; prompt: number; completion: number };
export type Usage = { prompt: number; completion: number; cost?: number };
export type Turn = { role: 'user' | 'assistant'; content: string };

export class OpenRouterError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.name = 'OpenRouterError';
        this.status = status;
    }
}

// No cookies, no referrer, no attribution headers: OpenRouter learns the key, the model and the text, nothing else.
const init = (key: string): RequestInit => ({
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store'
});

async function explain(res: Response): Promise<OpenRouterError> {
    let message = '';
    try {
        const body = (await res.json()) as { error?: { message?: string } };
        message = body.error?.message ?? '';
    } catch {}
    if (res.status === 401) return new OpenRouterError(401, 'OpenRouter did not accept the key. Check it in Settings.');
    if (res.status === 402) return new OpenRouterError(402, 'Out of credits, or the key hit its spending limit.');
    if (res.status === 404 && /endpoint|data policy|provider/i.test(message)) {
        return new OpenRouterError(404, 'No zero-data-retention provider serves this model right now. Pick another.');
    }
    if (res.status === 429) return new OpenRouterError(429, 'Rate limited by OpenRouter. Wait a moment.');
    return new OpenRouterError(res.status, message || `OpenRouter answered ${res.status}`);
}

/** Models that have at least one zero-data-retention endpoint. */
export async function zdrModels(key: string): Promise<Model[]> {
    const res = await fetch(`${BASE}/models?zdr=true`, { ...init(key), method: 'GET' });
    if (!res.ok) throw await explain(res);
    const body = (await res.json()) as {
        data: { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string } }[];
    };
    return body.data
        .map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            context: m.context_length ?? 0,
            prompt: Number(m.pricing?.prompt ?? 0),
            completion: Number(m.pricing?.completion ?? 0)
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Streams one reply. `onDelta` gets each piece of text as it arrives; the
 * promise resolves with the whole reply. Abort with `signal` to stop early:
 * what arrived so far is returned, not lost.
 */
export async function streamChat(options: {
    key: string;
    model: string;
    messages: Turn[];
    signal?: AbortSignal;
    onDelta: (text: string) => void;
}): Promise<{ content: string; model: string; usage?: Usage; stopped: boolean }> {
    const res = await fetch(`${BASE}/chat/completions`, {
        ...init(options.key),
        method: 'POST',
        signal: options.signal,
        body: JSON.stringify({
            model: options.model,
            messages: options.messages,
            stream: true,
            provider: { zdr: true, data_collection: 'deny' },
            usage: { include: true }
        })
    });
    if (!res.ok || !res.body) throw await explain(res);

    let content = '';
    let model = options.model;
    let usage: Usage | undefined;
    let buffer = '';
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let newline: number;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                // Comments (": OPENROUTER PROCESSING") keep the connection alive; skip them.
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (data === '[DONE]') return { content, model, usage, stopped: false };
                let chunk: {
                    model?: string;
                    error?: { message?: string; code?: number };
                    choices?: { delta?: { content?: string | null } }[];
                    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
                };
                try {
                    chunk = JSON.parse(data);
                } catch {
                    continue;
                }
                if (chunk.error) throw new OpenRouterError(chunk.error.code ?? 500, chunk.error.message ?? 'The model failed mid-reply');
                if (chunk.model) model = chunk.model;
                const piece = chunk.choices?.[0]?.delta?.content;
                if (piece) {
                    content += piece;
                    options.onDelta(piece);
                }
                if (chunk.usage) {
                    usage = { prompt: chunk.usage.prompt_tokens ?? 0, completion: chunk.usage.completion_tokens ?? 0, cost: chunk.usage.cost };
                }
            }
        }
    } catch (err) {
        if (options.signal?.aborted) return { content, model, usage, stopped: true };
        throw err;
    } finally {
        reader.releaseLock();
    }
    return { content, model, usage, stopped: false };
}
