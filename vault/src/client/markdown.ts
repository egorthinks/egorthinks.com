/**
 * Markdown to HTML for the preview. Notes are mostly text pasted from
 * elsewhere, so the HTML is treated as hostile: DOMPurify strips anything
 * that could run, and the CSP would refuse it anyway.
 *
 * Images: ![alt](vault:<id>) becomes <img data-vault="<id>">, filled in later
 * with a decrypted blob: URL. Remote images are shown as links instead, since
 * loading one would tell its host that this note was just opened.
 */
import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const marked = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
        image({ href, text }) {
            const id = /^vault:([0-9a-f]{32})$/.exec(href)?.[1];
            if (id) return `<img data-vault="${id}" alt="${escape(text)}">`;
            return `<a href="${escape(href)}">${escape(text || href)}</a>`;
        }
    }
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
    }
    // Raw <img>, <video> or <source> in pasted HTML would load on their own; only vault images load, and only by id.
    if (node.hasAttribute('src') || node.hasAttribute('srcset')) {
        node.removeAttribute('src');
        node.removeAttribute('srcset');
    }
});

export function render(markdown: string): string {
    const html = marked.parse(markdown, { async: false }) as string;
    return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'] });
}
