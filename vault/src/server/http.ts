export function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function fail(status: number, error: string): Response {
    return json({ error }, status);
}

/** Errors are logged in full on the server and reported vaguely to the browser. */
export function crash(where: string, err: unknown): Response {
    console.error(`[vault] ${where}:`, err);
    return fail(500, 'Something went wrong on the server');
}

export async function readJson<T>(request: Request, maxBytes = 64 * 1024): Promise<T | null> {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
}
