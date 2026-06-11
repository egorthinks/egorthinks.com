import { glob } from 'astro/loaders';
import { defineCollection, z, type ImageFunction } from 'astro:content';

const imageSchema = (image: ImageFunction) =>
    z.object({
        src: image(),
        alt: z.string().optional()
    });

const seoSchema = (image: ImageFunction) =>
    z.object({
        title: z.string().min(5).max(120).optional(),
        description: z.string().min(15).max(160).optional(),
        image: imageSchema(image).optional(),
        pageType: z.enum(['website', 'article']).default('website')
    });

const faqSchema = z.array(
    z.object({
        question: z.string(),
        answer: z.string()
    })
);

const blog = defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
    schema: ({ image }) =>
        z.object({
            title: z.string(),
            excerpt: z.string().optional(),
            publishDate: z.coerce.date(),
            updatedDate: z.coerce.date().optional(),
            isFeatured: z.boolean().default(false),
            tags: z.array(z.string()).default([]),
            faq: faqSchema.optional(),
            seo: seoSchema(image).optional()
        })
});

const pages = defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/pages' }),
    schema: ({ image }) =>
        z.object({
            title: z.string(),
            publishDate: z.coerce.date().optional(),
            updatedDate: z.coerce.date().optional(),
            faq: faqSchema.optional(),
            seo: seoSchema(image).optional()
        })
});

const glossary = defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/glossary' }),
    schema: ({ image }) =>
        z.object({
            title: z.string(),
            // Short plain-text definition used for the DefinedTerm schema and the glossary hub listing
            definition: z.string().min(40).max(360),
            publishDate: z.coerce.date(),
            updatedDate: z.coerce.date().optional(),
            related: z.array(z.string()).default([]),
            faq: faqSchema.optional(),
            seo: seoSchema(image).optional()
        })
});

export const collections = { blog, pages, glossary };
