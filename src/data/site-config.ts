import type { SiteConfig } from '../types';
import ogDefault from '../assets/og-default.png';

const siteConfig: SiteConfig = {
    website: 'https://www.egorthinks.com/',
    title: 'Egor Fedorov',
    subtitle: 'Notes on cognition, focus, and code',
    description: 'Tools and notes for developers who code with AI and want to stay sharp.',
    image: {
        src: ogDefault,
        alt: 'Egor Fedorov — Notes on cognition, focus, and code'
    },
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
            text: 'Topics',
            href: '/tags'
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
            text: 'LinkedIn',
            href: 'https://www.linkedin.com/in/egorthinks'
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
        enabled: true,
        title: 'Notes by email',
        text: 'Occasional essays on cognition and code. 1–2 per month. No spam, ever.',
        form: {
            // Replace YOUR_USERNAME with your Buttondown username (e.g. egorthinks → buttondown.com/egorthinks)
            action: 'https://buttondown.com/api/emails/embed-subscribe/egorthinks',
            emailFieldName: 'email',
            hiddenFields: [{ name: 'embed', value: '1' }]
        }
    },
    postsPerPage: 8
};

export default siteConfig;
