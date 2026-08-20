/**
 * Which pages get a generated OG card, and what goes on it.
 *
 * Shared by the endpoint that renders the cards and by BaseHead, which points
 * at them. One list, so a page can never advertise a card that was not built -
 * or be built a card that nothing points at.
 */
import { getCollection } from 'astro:content';
import siteConfig from '../data/site-config';
import { clampDescription, type OgCard } from './og';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export type OgEntry = { slug: string; card: OgCard };

let entriesPromise: Promise<Map<string, OgCard>> | undefined;

/** Route path to card slug: `/blog/git-bonsai/` becomes `blog/git-bonsai`. */
export function ogSlugForPath(pathname: string): string {
    return pathname.replace(/^\/+|\/+$/g, '') || 'index';
}

export function ogEntries(): Promise<Map<string, OgCard>> {
    entriesPromise ??= (async () => {
        const [posts, glossary, pages] = await Promise.all([getCollection('blog'), getCollection('glossary'), getCollection('pages')]);

        const entries: OgEntry[] = [
            {
                slug: 'index',
                card: {
                    kind: 'Notes on cognition, focus, and code',
                    title: siteConfig.hero?.title ?? siteConfig.title,
                    description: clampDescription(siteConfig.description)
                }
            },
            {
                slug: 'bonsai',
                card: {
                    kind: 'Playground',
                    title: 'Every GitHub account grows exactly one tree',
                    description: clampDescription('Type a username and watch its bonsai grow. Streaks bloom, silences leave deadwood.')
                }
            },
            {
                slug: 'design',
                card: {
                    kind: 'Design system',
                    title: 'Ink, paper, and a dashed line',
                    description: clampDescription('One monochrome palette, one motif, and every element built on top of them.')
                }
            },
            ...posts.map((post) => ({
                slug: `blog/${post.id}`,
                card: {
                    kind: post.data.kind,
                    title: post.data.title,
                    description: clampDescription(post.data.excerpt),
                    meta: dateFmt.format(post.data.updatedDate ?? post.data.publishDate)
                }
            })),
            ...glossary.map((term) => ({
                slug: `glossary/${term.id}`,
                card: {
                    kind: 'Glossary',
                    title: term.data.title,
                    description: clampDescription(term.data.definition),
                    meta: dateFmt.format(term.data.updatedDate ?? term.data.publishDate)
                }
            })),
            ...pages.map((page) => ({
                slug: page.id,
                card: {
                    kind: 'Page',
                    title: page.data.title,
                    description: clampDescription(page.data.seo?.description),
                    meta: page.data.updatedDate ? `Updated ${dateFmt.format(page.data.updatedDate)}` : undefined
                }
            }))
        ];

        return new Map(entries.map((entry) => [entry.slug, entry.card]));
    })();

    return entriesPromise;
}
