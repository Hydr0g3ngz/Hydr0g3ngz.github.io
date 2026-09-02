import { z } from 'astro/zod';

const anchorId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'Use lowercase letters, numbers, and hyphens.')
  .optional();

const localImage = z
  .string()
  .regex(/^\/(images|uploads)\//, 'Images must come from /images or /uploads.');

const safeLink = z.string().min(1).refine(
  (value) => value.startsWith('/') || value.startsWith('#') || value.startsWith('https://'),
  'Links must be internal paths, page anchors, or HTTPS URLs.'
);

const baseBlock = {
  id: anchorId,
  visible: z.boolean().default(true)
};

const linkSchema = z.object({
  label: z.string().min(1),
  href: safeLink,
  style: z.enum(['primary', 'secondary', 'text']).default('secondary')
});

const imageCreditSchema = z.object({
  label: z.string().min(1),
  url: z.url(),
  licenseLabel: z.string().optional(),
  licenseUrl: z.url().optional()
});

export const heroBlockSchema = z.object({
  type: z.literal('hero'),
  ...baseBlock,
  eyebrow: z.string().min(1),
  heading: z.string().min(1),
  lede: z.string().min(1),
  intro: z.string().min(1),
  links: z.array(linkSchema).max(4).default([])
});

export const marqueeBlockSchema = z.object({
  type: z.literal('marquee'),
  ...baseBlock,
  label: z.string().default('Current interests'),
  items: z.array(z.string().min(1)).min(1)
});

const shelfItemSchema = z.object({
  title: z.string().min(1),
  originalTitle: z.string().optional()
});

const shelfCategorySchema = z.object({
  tag: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  image: localImage,
  imageAlt: z.string().min(1),
  imageWidth: z.number().int().positive().optional(),
  imageHeight: z.number().int().positive().optional(),
  listLayout: z.enum(['single', 'two-column']).default('single'),
  items: z.array(shelfItemSchema).default([]),
  future: z.string().optional()
});

const followingItemSchema = z.object({
  tag: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  image: localImage,
  imageAlt: z.string().min(1),
  imageWidth: z.number().int().positive().optional(),
  imageHeight: z.number().int().positive().optional()
});

export const shelfBlockSchema = z.object({
  type: z.literal('shelf'),
  ...baseBlock,
  eyebrow: z.string().min(1),
  heading: z.string().min(1),
  intro: z.string().min(1),
  categories: z.array(shelfCategorySchema).min(1).max(6),
  following: z
    .object({
      visible: z.boolean().default(false),
      tag: z.string().default('OTHER INTERESTS'),
      heading: z.string().default('Also following'),
      intro: z.string().default('A smaller corner for other things I follow.'),
      items: z.array(followingItemSchema).max(4).default([])
    })
    .optional(),
  creditsLabel: z.string().default('Images:'),
  credits: z.array(imageCreditSchema).default([])
});

const workItemSchema = z.object({
  year: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  href: safeLink.optional()
});

export const workBlockSchema = z.object({
  type: z.literal('work'),
  ...baseBlock,
  eyebrow: z.string().min(1),
  intro: z.string().min(1),
  items: z.array(workItemSchema).default([])
});

export const closingBlockSchema = z.object({
  type: z.literal('closing'),
  ...baseBlock,
  eyebrow: z.string().min(1),
  heading: z.string().min(1),
  body: z.string().min(1)
});

export const textBlockSchema = z.object({
  type: z.literal('text'),
  ...baseBlock,
  eyebrow: z.string().optional(),
  heading: z.string().min(1),
  body: z.string().min(1),
  width: z.enum(['narrow', 'wide']).default('narrow')
});

export const imageTextBlockSchema = z.object({
  type: z.literal('image_text'),
  ...baseBlock,
  eyebrow: z.string().optional(),
  heading: z.string().min(1),
  body: z.string().min(1),
  image: localImage,
  imageAlt: z.string().min(1),
  imageCredit: z.string().optional(),
  imagePosition: z.enum(['left', 'right']).default('left')
});

export const listBlockSchema = z.object({
  type: z.literal('list'),
  ...baseBlock,
  eyebrow: z.string().optional(),
  heading: z.string().min(1),
  intro: z.string().optional(),
  columns: z.enum(['one', 'two', 'three']).default('two'),
  items: z
    .array(
      z.object({
        title: z.string().min(1),
        text: z.string().min(1),
        meta: z.string().optional(),
        href: safeLink.optional()
      })
    )
    .default([])
});

export const quoteBlockSchema = z.object({
  type: z.literal('quote'),
  ...baseBlock,
  quote: z.string().min(1),
  attribution: z.string().optional()
});

export const profileBlockSchema = z.object({
  type: z.literal('profile'),
  ...baseBlock,
  paragraphs: z.array(z.string().min(1)).min(1),
  facts: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.string().min(1),
        href: safeLink.optional()
      })
    )
    .default([])
});

export const blockSchema = z.discriminatedUnion('type', [
  heroBlockSchema,
  marqueeBlockSchema,
  shelfBlockSchema,
  workBlockSchema,
  closingBlockSchema,
  textBlockSchema,
  imageTextBlockSchema,
  listBlockSchema,
  quoteBlockSchema,
  profileBlockSchema
]);

export const homeSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  sections: z.array(blockSchema).min(1)
});

export const navigationSchema = z.object({
  show: z.boolean().default(false),
  label: z.string().min(1),
  order: z.number().int().default(100)
});

export const pageSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  eyebrow: z.string().optional(),
  heading: z.string().min(1),
  published: z.boolean().default(false),
  navigation: navigationSchema,
  sections: z.array(blockSchema).default([])
});

export const noteSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    category: z.enum(['Books', 'Music', 'Film', 'Research', 'Other']),
    published: z.boolean().default(false),
    cover: localImage.optional(),
    coverAlt: z.string().optional()
  })
  .superRefine((value, context) => {
    if (value.cover && !value.coverAlt?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['coverAlt'],
        message: 'Cover alt text is required when a cover image is present.'
      });
    }
  });

export const siteSettingsSchema = z.object({
  brand: z.string().min(1),
  defaultTitle: z.string().min(1),
  description: z.string().min(1),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  homeLinks: z
    .array(
      z.object({
        label: z.string().min(1),
        href: safeLink,
        order: z.number().int(),
        visible: z.boolean().default(true)
      })
    )
    .default([]),
  notesNavigation: z.object({
    label: z.string().min(1),
    order: z.number().int()
  }),
  footerText: z.string().min(1),
  footerLinks: z
    .array(
      z.object({
        label: z.string().min(1),
        href: safeLink
      })
    )
    .default([])
});

export type Block = z.infer<typeof blockSchema>;
export type HeroBlock = z.infer<typeof heroBlockSchema>;
export type MarqueeBlock = z.infer<typeof marqueeBlockSchema>;
export type ShelfBlock = z.infer<typeof shelfBlockSchema>;
export type WorkBlock = z.infer<typeof workBlockSchema>;
export type ClosingBlock = z.infer<typeof closingBlockSchema>;
export type TextBlock = z.infer<typeof textBlockSchema>;
export type ImageTextBlock = z.infer<typeof imageTextBlockSchema>;
export type ListBlock = z.infer<typeof listBlockSchema>;
export type QuoteBlock = z.infer<typeof quoteBlockSchema>;
export type ProfileBlock = z.infer<typeof profileBlockSchema>;
