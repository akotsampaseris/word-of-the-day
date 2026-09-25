/**
 * The data contract for one day's entry.
 *
 * Every file in content/ named YYYY-MM-DD.json is either:
 *   - an Entry (the normal case), or
 *   - a FailedDraft: generation gave up after MAX_ATTEMPTS, so the file holds
 *     whatever the last attempt produced plus an `_errors` list for a human.
 *
 * The site and the pipeline both import from this file, so there is exactly one
 * definition of what valid content looks like.
 */
import { z } from 'zod';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// z.iso.date() only accepts real calendar dates in YYYY-MM-DD form (it knows
// about month lengths and leap years), so "2026-02-30" is rejected.
export const IsoDateSchema = z.iso.date();

export const StatusSchema = z.enum(['draft', 'approved']);

export const ImageSchema = z.strictObject({
  // An absolute https URL in object storage, or a site-relative path such as
  // /mock-images/... when the mock image provider is in use.
  url: z.string().refine((value) => value.startsWith('/') || isHttpUrl(value), {
    message: 'must be an absolute http(s) URL or a site-relative path',
  }),
  prompt: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  alt: z.string().min(1).max(300),
});

export const EntrySchema = z.strictObject({
  slug: z.string().regex(SLUG_PATTERN, 'must be lowercase letters, digits and single hyphens'),
  word: z.string().min(1),
  date: IsoDateSchema,
  status: StatusSchema,
  pronunciation: z.string().min(1),
  partOfSpeech: z.string().min(1),
  definition: z.string().min(1).max(300),
  etymology: z.string().min(1).max(800),
  etymologySources: z.array(z.url({ protocol: /^https?$/ })).min(1),
  story: z.string().min(1),
  image: ImageSchema,
  generatedAt: z.iso.datetime(),
});

export type Entry = z.infer<typeof EntrySchema>;
export type EntryStatus = z.infer<typeof StatusSchema>;
export type EntryImage = z.infer<typeof ImageSchema>;

/**
 * A draft that failed validation MAX_ATTEMPTS times. Only the fields the
 * pipeline itself controls are guaranteed; everything else is whatever the
 * last attempt produced (looseObject keeps unknown keys instead of dropping them).
 * It can never be approved until a human fixes it and removes `_errors`.
 */
export const FailedDraftSchema = z.looseObject({
  slug: z.string().regex(SLUG_PATTERN),
  word: z.string().min(1),
  date: IsoDateSchema,
  status: z.literal('draft'),
  generatedAt: z.iso.datetime(),
  _errors: z.array(z.string()).min(1),
});

export type FailedDraft = z.infer<typeof FailedDraftSchema>;

/**
 * What the text model must return. The pipeline adds everything else
 * (slug, date, status, sources, image URL, timestamps) itself, so the model
 * never gets the chance to invent a source URL or a date.
 */
export const TextOutputSchema = z.strictObject({
  pronunciation: z.string().min(1),
  partOfSpeech: z.string().min(1),
  definition: z.string().min(1).max(300),
  etymology: z.string().min(1).max(800),
  story: z.string().min(1),
  imagePrompt: z
    .string()
    .min(1)
    .max(300)
    .refine((value) => !value.includes('\n'), { message: 'must be a single line' }),
  imageAlt: z.string().min(1).max(300),
});

export type TextOutput = z.infer<typeof TextOutputSchema>;

/** Turns zod issues into short, readable lines like "definition: Too big: ...". */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
