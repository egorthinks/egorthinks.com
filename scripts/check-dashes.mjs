import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Blocks typographic dashes in content: figure dash, en dash, em dash, horizontal bar
const BANNED = /[‒–—―]/;
// fileURLToPath, not .pathname: on Windows the latter hands back "/C:/..." and
// every join after it builds a path that does not exist.
const CONTENT_DIR = fileURLToPath(new URL('../src/content', import.meta.url));

function* walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(path);
        else if (/\.mdx?$/.test(entry.name)) yield path;
    }
}

let failed = false;
for (const file of walk(CONTENT_DIR)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
        const match = line.match(BANNED);
        if (match) {
            failed = true;
            console.error(`${relative(process.cwd(), file)}:${i + 1} contains "${match[0]}" (U+${match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
        }
    });
}

if (failed) {
    console.error('\nTypographic dashes are blocked in content. Use a plain hyphen instead.');
    process.exit(1);
}
console.log('check-dashes: content is clean.');
