/**
 * Open Graph card rendering, from the same tokens as the site.
 *
 * A link that previews as a blank rectangle is a link nobody clicks, and every
 * artifact here is built to be shared. These cards are the design system at
 * 1200x630: paper, ink, a dashed frame, Newsreader for the voice and Inter for
 * the data.
 *
 * Fonts come from the static @fontsource packages rather than the variable ones
 * the site itself loads: satori's opentype fork reads the `fvar` table, and the
 * fontsource variable subsets strip the `name` entries it expects, so every one
 * of them throws on parse. Static instances have no fvar table at all. They are
 * devDependencies, decompressed at build time, so nothing extra ships to the
 * browser and there are no font binaries in the repo.
 */
import { readFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { decompress } from 'wawoff2';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** Light card only: an OG image has no way to know the reader's theme. */
const PAPER = '#f2f1ec';
const INK = '#171717';
const INK_70 = '#5c5c5b';
const INK_45 = '#8f8e8a';

const FONT_FILES = {
    serif: 'node_modules/@fontsource/newsreader/files/newsreader-latin-500-normal.woff2',
    serifItalic: 'node_modules/@fontsource/newsreader/files/newsreader-latin-400-italic.woff2',
    sans: 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2'
} as const;

type SatoriFont = { name: string; data: ArrayBuffer; weight: 400 | 500; style: 'normal' | 'italic' };

let fontsPromise: Promise<SatoriFont[]> | undefined;

/**
 * Decompressed once per build, not once per page.
 *
 * The result is handed over as a standalone ArrayBuffer rather than a Buffer:
 * `Buffer.from` allocates out of a shared pool, so its `.buffer` is the whole
 * pool at some offset, and satori's font parser reads that as garbage.
 */
function loadFonts(): Promise<SatoriFont[]> {
    fontsPromise ??= (async () => {
        const [serif, serifItalic, sans] = await Promise.all(
            [FONT_FILES.serif, FONT_FILES.serifItalic, FONT_FILES.sans].map(async (path) => {
                const bytes = await decompress(await readFile(new URL(`../../${path}`, import.meta.url)));
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            })
        );
        return [
            { name: 'Newsreader', data: serif, weight: 500, style: 'normal' },
            { name: 'Newsreader', data: serifItalic, weight: 400, style: 'italic' },
            { name: 'Inter', data: sans, weight: 400, style: 'normal' }
        ] satisfies SatoriFont[];
    })();
    return fontsPromise;
}

export type OgCard = {
    title: string;
    /** Sits above the title: "Essay", "Glossary", "Widget", "Design system". */
    kind?: string;
    /** One line under the rule. Excerpt, definition, or the artifact's lede. */
    description?: string;
    /** Bottom right. A date, a version, a score - whatever dates the card. */
    meta?: string;
    site?: string;
};

/** Title sizing: long titles step down rather than overflowing the card. */
function titleSize(title: string): number {
    if (title.length > 84) return 50;
    if (title.length > 56) return 60;
    if (title.length > 34) return 70;
    return 78;
}

/**
 * The dashed frame, as an inline SVG. Satori has no repeating-gradient support
 * and its `borderStyle: dashed` gives no control over dash length, so the frame
 * is drawn with the same 7-on 5-off rhythm the site uses everywhere else.
 */
function frameSvg(): string {
    const w = OG_WIDTH - 80;
    const h = OG_HEIGHT - 80;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" stroke="${INK_45}" stroke-width="1" stroke-dasharray="7 5"/></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** The same dashed rule that separates sections on the site. */
function ruleSvg(width: number): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="1" viewBox="0 0 ${width} 1" fill="none"><line x1="0" y1="0.5" x2="${width}" y2="0.5" stroke="${INK_45}" stroke-width="1" stroke-dasharray="7 5"/></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** A drawn arrow in the corner, so the card is recognisably from this site. */
function markSvg(): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="24" viewBox="0 0 200 24" fill="none"><path d="M4 12 C 54 9, 128 15, 188 11.5" stroke="${INK_45}" stroke-width="2" stroke-dasharray="7 5" stroke-linecap="round"/><path d="M177 5.5 L188 11.5 L178 18" stroke="${INK_45}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Renders one card to PNG. */
export async function renderOgPng(card: OgCard): Promise<Buffer> {
    const { title, kind, description, meta, site = 'egorthinks.com' } = card;
    const fonts = await loadFonts();

    const tree = {
        type: 'div',
        props: {
            style: {
                width: '100%',
                height: '100%',
                display: 'flex',
                position: 'relative',
                backgroundColor: PAPER,
                fontFamily: 'Inter'
            },
            children: [
                // Dashed frame
                {
                    type: 'img',
                    props: { src: frameSvg(), width: OG_WIDTH - 80, height: OG_HEIGHT - 80, style: { position: 'absolute', left: 40, top: 40 } }
                },
                // Content column
                {
                    type: 'div',
                    props: {
                        style: {
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            position: 'absolute',
                            left: 88,
                            top: 88,
                            width: OG_WIDTH - 176,
                            height: OG_HEIGHT - 176
                        },
                        children: [
                            // Eyebrow
                            {
                                type: 'div',
                                props: {
                                    style: { display: 'flex', fontSize: 21, letterSpacing: 3, textTransform: 'uppercase', color: INK_70 },
                                    children: kind ? `${kind} · ${site}` : site
                                }
                            },
                            // Title
                            {
                                type: 'div',
                                props: {
                                    style: {
                                        display: 'flex',
                                        fontFamily: 'Newsreader',
                                        fontWeight: 500,
                                        fontSize: titleSize(title),
                                        lineHeight: 1.14,
                                        color: INK,
                                        letterSpacing: -0.5,
                                        marginTop: 28,
                                        marginBottom: 'auto'
                                    },
                                    children: title
                                }
                            },
                            // Footer: rule, description, meta
                            {
                                type: 'div',
                                props: {
                                    style: { display: 'flex', flexDirection: 'column' },
                                    children: [
                                        {
                                            type: 'img',
                                            props: { src: ruleSvg(OG_WIDTH - 176), width: OG_WIDTH - 176, height: 1, style: { marginBottom: 26 } }
                                        },
                                        {
                                            type: 'div',
                                            props: {
                                                style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', width: '100%' },
                                                children: [
                                                    {
                                                        type: 'div',
                                                        props: {
                                                            style: { display: 'flex', flexDirection: 'column', maxWidth: 780 },
                                                            children: [
                                                                description
                                                                    ? {
                                                                          type: 'div',
                                                                          props: {
                                                                              style: { display: 'flex', fontSize: 25, lineHeight: 1.45, color: INK_70 },
                                                                              children: description
                                                                          }
                                                                      }
                                                                    : null,
                                                                meta
                                                                    ? {
                                                                          type: 'div',
                                                                          props: {
                                                                              style: {
                                                                                  display: 'flex',
                                                                                  fontSize: 20,
                                                                                  color: INK_45,
                                                                                  marginTop: description ? 14 : 0
                                                                              },
                                                                              children: meta
                                                                          }
                                                                      }
                                                                    : null
                                                            ].filter(Boolean)
                                                        }
                                                    },
                                                    {
                                                        type: 'img',
                                                        props: { src: markSvg(), width: 130, height: 16, style: { marginLeft: 40, marginBottom: 8 } }
                                                    }
                                                ]
                                            }
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                }
            ]
        }
    };

    const svg = await satori(tree as Parameters<typeof satori>[0], { width: OG_WIDTH, height: OG_HEIGHT, fonts });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
    return Buffer.from(png);
}

/** Trims a description to something that fits under the rule. */
export function clampDescription(text: string | undefined, limit = 150): string | undefined {
    if (!text) return undefined;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= limit) return clean;
    return `${clean.slice(0, clean.lastIndexOf(' ', limit - 1))}...`;
}
