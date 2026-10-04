/**
 * Get plain markdown back without the website.
 *
 *   git clone git@github.com:<owner>/<data-repo>.git vault-data
 *   npm run decrypt -- vault-data ./notes-out
 *
 * Asks for the master password (or pass --recovery to use the recovery key).
 * VAULT_PASSWORD / VAULT_RECOVERY_KEY in the environment skip the prompt.
 *
 * Writes one .md per note, with its title and dates as front matter, and the
 * attachments under files/, with every vault:<id> image link rewritten to the
 * file. Nothing touches the network: this is the way out if the site, Vercel or
 * this code's server half ever disappears. It reads notes/ directly rather than
 * trusting the manifest, so a damaged index loses nothing.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { open, openJson, parseHeader, unlockWithPassword, unlockWithRecovery, type Bytes } from '../src/lib/crypto.ts';
import { decodeFile, ID_RE, PATHS, type Note } from '../src/lib/model.ts';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

function ask(question: string): Promise<string> {
    // No echo: the answer is a password.
    return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
        (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
            if (s.startsWith(question)) write.call(rl, question);
        };
        rl.question(question, (answer) => {
            rl.close();
            process.stdout.write('\n');
            resolve(answer);
        });
    });
}

async function read(path: string): Promise<Bytes> {
    return new Uint8Array(await readFile(path));
}

async function list(dir: string): Promise<string[]> {
    try {
        return await readdir(dir);
    } catch {
        return [];
    }
}

function fileName(title: string, id: string, taken: Set<string>): string {
    const base =
        title
            .replace(/[/\\:*?"<>|\u0000-\u001f]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80) || 'Untitled';
    let name = `${base}.md`;
    if (taken.has(name.toLowerCase())) name = `${base} (${id.slice(0, 6)}).md`;
    taken.add(name.toLowerCase());
    return name;
}

async function main() {
    const args = process.argv.slice(2).filter((a) => a !== '--recovery');
    const useRecovery = process.argv.includes('--recovery');
    const [repo, out] = args;
    if (!repo || !out) {
        console.error('Usage: npm run decrypt -- <cloned-data-repo> <output-dir> [--recovery]');
        process.exit(2);
    }

    const header = parseHeader(await readFile(join(repo, PATHS.header), 'utf8'));
    const key = useRecovery
        ? await unlockWithRecovery(header, process.env.VAULT_RECOVERY_KEY ?? (await ask('Recovery key: ')))
        : await unlockWithPassword(header, process.env.VAULT_PASSWORD ?? (await ask('Master password: ')));

    await mkdir(join(out, 'files'), { recursive: true });

    const fileLinks = new Map<string, string>();
    for (const entry of await list(join(repo, 'files'))) {
        const id = entry.replace(/\.enc$/, '');
        if (!ID_RE.test(id)) continue;
        const file = decodeFile(await open(key, PATHS.file(id), await read(join(repo, PATHS.file(id)))));
        const name = `${id}.${EXT[file.type] ?? 'bin'}`;
        await writeFile(join(out, 'files', name), file.bytes);
        fileLinks.set(id, `files/${name}`);
    }

    const taken = new Set<string>();
    let count = 0;
    for (const entry of (await list(join(repo, 'notes'))).sort()) {
        const id = entry.replace(/\.md\.enc$/, '');
        if (!ID_RE.test(id)) continue;
        const note = await openJson<Note>(key, PATHS.note(id), await read(join(repo, PATHS.note(id))));
        const body = note.body.replace(/vault:([0-9a-f]{32})/g, (m, fid: string) => fileLinks.get(fid) ?? m);
        const front = ['---', `title: ${JSON.stringify(note.title)}`, `created: ${note.created}`, `updated: ${note.updated}`, `id: ${note.id}`, '---', ''];
        await writeFile(join(out, fileName(note.title, id, taken)), front.join('\n') + body);
        count++;
    }

    console.log(`Decrypted ${count} note(s) and ${fileLinks.size} attachment(s) into ${out}`);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
