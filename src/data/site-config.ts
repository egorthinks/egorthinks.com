import type { SiteConfig } from '../types';

const siteConfig: SiteConfig = {
    website: 'https://egorthinks.com',
    title: 'Egor Fedorov',
    subtitle: 'Notes on cognition, focus, and code',
    description: 'Tools and notes for developers who code with AI and want to stay sharp.',
    twitterHandle: '@egorthinks',
    headerNavLinks: [
        {
            text: 'Home',
            href: '/'
        },
        {
            text: 'Writing',
            href: '/blog'
        }
    ],
    footerNavLinks: [
        {
            text: 'About',
            href: '/about'
        },
        {
            text: 'RSS',
            href: '/rss.xml'
        }
    ],
    socialLinks: [
        {
            text: 'X',
            href: 'https://x.com/egorthinks'
        },
        {
            text: 'GitHub',
            href: 'https://github.com/egorthinks'
        }
    ],
    hero: {
        title: 'I write about staying sharp while AI codes.',
        text: "I'm a founder building tools for developers who code with AI and quietly suspect it's making them dumber.\n\nHere I write about attention, memory, dopamine, and what happens to your brain after eight hours of accepting Claude's diffs. Short essays, screenshots, occasional honest panic.",
        actions: []
    },
    subscribe: {
        enabled: false
    },
    postsPerPage: 8
};

export default siteConfig;
