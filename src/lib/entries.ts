/**
 * Loads content for the site at build time. This is the "publish step":
 * only approved entries dated today or earlier make it onto the site.
 *
 * It reuses the pipeline's schema and publish rule, so the site and the
 * pipeline can never disagree about what valid, publishable content is.
 */
import { dateFromFilename, todayIn } from '../../pipeline/dates';
import { findDuplicateSlugs, selectPublished } from '../../pipeline/publish';
import { EntrySchema, formatZodIssues, type Entry } from '../../pipeline/schema';

// Vite bundles every content file at build time, and watches them in dev.
const contentFiles = import.meta.glob<unknown>('../../content/*.json', { eager: true, import: 'default' });

/** "Today" for the site, in SITE_TIMEZONE. Evaluated at build time for the static site. */
export function siteToday(): string {
  return todayIn(process.env.SITE_TIMEZONE || 'UTC');
}

/** Published entries, newest first. The first one is what the home page shows. */
export function getPublishedEntries(): Entry[] {
  const published = selectPublished(loadEntries(), siteToday());
  const duplicates = findDuplicateSlugs(published);
  if (duplicates.length > 0) {
    throw new Error(`These slugs are used by more than one published entry: ${duplicates.join(', ')}`);
  }
  return published;
}

function loadEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const [filePath, data] of Object.entries(contentFiles)) {
    const filename = filePath.split('/').pop()!;
    if (dateFromFilename(filename) === null) continue; // e.g. words.json

    const result = EntrySchema.safeParse(data);
    if (result.success) {
      entries.push(result.data);
    } else if (isApproved(data)) {
      // A draft that fails validation just stays unpublished. An *approved*
      // entry that fails is a mistake, and it is better to stop the build
      // than to silently drop a day.
      throw new Error(`content/${filename} is approved but invalid:\n  ${formatZodIssues(result.error).join('\n  ')}`);
    }
  }
  return entries;
}

function isApproved(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { status?: unknown }).status === 'approved';
}
