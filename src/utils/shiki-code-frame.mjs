/**
 * Shiki transformer that gives every fenced code block the CodeFrame chrome:
 * a dashed box with a label tab carrying the filename or the language.
 *
 * Done here rather than as an MDX component override so it applies to .md and
 * .mdx equally, and so a post never has to remember to wrap its own snippets.
 *
 * Label comes from the fence meta when there is one:
 *
 *   ```yaml title=".github/workflows/bonsai.yml"
 *
 * and falls back to the language.
 */
export function codeFrameTransformer() {
    return {
        name: 'pencil-code-frame',
        root(node) {
            const pre = node.children.find((child) => child.type === 'element' && child.tagName === 'pre');
            if (!pre) return;

            const raw = this.options?.meta?.__raw ?? '';
            const titled = raw.match(/title=(?:"([^"]*)"|'([^']*)')/);
            const label = titled?.[1] || titled?.[2] || this.options?.lang || 'code';

            node.children = [
                {
                    type: 'element',
                    tagName: 'figure',
                    properties: { className: ['code-frame'] },
                    children: [
                        {
                            type: 'element',
                            tagName: 'figcaption',
                            properties: { className: ['code-frame-head'] },
                            children: [
                                {
                                    type: 'element',
                                    tagName: 'span',
                                    properties: { className: ['code-frame-dots'], 'aria-hidden': 'true' },
                                    children: [{ type: 'text', value: '···' }]
                                },
                                {
                                    type: 'element',
                                    tagName: 'span',
                                    properties: { className: ['code-frame-label'] },
                                    children: [{ type: 'text', value: label }]
                                }
                            ]
                        },
                        pre
                    ]
                }
            ];
        }
    };
}
