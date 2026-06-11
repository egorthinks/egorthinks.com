import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import siteConfig from '../data/site-config';
import { sortItemsByDateDesc } from '../utils/data-utils';

export const GET: APIRoute = async () => {
    const siteUrl = siteConfig.website.replace(/\/$/, '');
    const posts = (await getCollection('blog')).sort(sortItemsByDateDesc);
    const glossary = (await getCollection('glossary')).sort((a, b) => a.data.title.localeCompare(b.data.title));
    const pages = await getCollection('pages');

    const research = pages.find((p) => p.id === 'research');
    const faq = pages.find((p) => p.id === 'faq');
    const about = pages.find((p) => p.id === 'about');

    const lines = [
        `# ${siteConfig.title}`,
        '',
        `> ${siteConfig.description} Essays and reference material on AI-induced cognitive decline in developers and knowledge workers: cognitive offloading, cognitive debt, skill atrophy, and how to use AI coding assistants without losing your skills.`,
        '',
        `Written by Egor Fedorov (@egorthinks), founder of SaveUrMind - a tool against AI-induced cognitive degradation in developers.`,
        ''
    ];

    if (research || faq) {
        lines.push('## Reference');
        if (research) {
            lines.push(`- [${research.data.title}](${siteUrl}/research/): ${research.data.seo?.description ?? 'A living review of every study on AI use and cognitive decline.'}`);
        }
        if (faq) {
            lines.push(`- [${faq.data.title}](${siteUrl}/faq/): ${faq.data.seo?.description ?? 'Direct answers to common questions about AI and cognitive decline.'}`);
        }
        lines.push('');
    }

    if (glossary.length > 0) {
        lines.push('## Glossary');
        lines.push(`- [AI & Cognition Glossary](${siteUrl}/glossary/): definitions of key terms`);
        for (const term of glossary) {
            lines.push(`- [${term.data.title}](${siteUrl}/glossary/${term.id}/): ${term.data.definition}`);
        }
        lines.push('');
    }

    if (posts.length > 0) {
        lines.push('## Essays');
        for (const post of posts) {
            lines.push(`- [${post.data.title}](${siteUrl}/blog/${post.id}/)${post.data.excerpt ? `: ${post.data.excerpt}` : ''}`);
        }
        lines.push('');
    }

    lines.push('## Optional');
    if (about) {
        lines.push(`- [About](${siteUrl}/about/): who writes this site`);
    }
    lines.push(`- [RSS feed](${siteUrl}/rss.xml)`);
    lines.push('');

    return new Response(lines.join('\n'), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
};
