import type { APIRoute, GetStaticPaths } from 'astro';
import { renderOgPng, type OgCard } from '../../utils/og';
import { ogEntries } from '../../utils/og-routes';

/**
 * One OG card per page, rendered at build time.
 *
 * The route mirrors the page it belongs to, so /blog/git-bonsai/ is pictured by
 * /og/blog/git-bonsai.png. BaseHead derives that URL from the canonical path,
 * which means a new post gets a card without anyone remembering to add one.
 */
export const getStaticPaths: GetStaticPaths = async () => {
    const entries = await ogEntries();
    return [...entries].map(([slug, card]) => ({ params: { slug }, props: { card } }));
};

export const GET: APIRoute = async ({ props }) => {
    const png = await renderOgPng(props.card as OgCard);
    return new Response(new Uint8Array(png), {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=31536000, immutable'
        }
    });
};
