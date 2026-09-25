/**
 * The publish rule, shared by the site build and the CLI:
 * an entry is public only if it is approved AND its date is today or earlier.
 * Drafts and future-dated entries are ignored, whatever else they contain.
 */
import type { Entry } from './schema';

/** Published entries, newest first. */
export function selectPublished(entries: Entry[], today: string): Entry[] {
  return entries
    .filter((entry) => entry.status === 'approved' && entry.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * The entry for the home page: today's, or the most recent published one if
 * today has none. Undefined only when nothing has ever been published.
 */
export function pickFeatured(entries: Entry[], today: string): Entry | undefined {
  return selectPublished(entries, today)[0];
}

/** Slugs used by more than one entry. Each slug must map to exactly one permalink. */
export function findDuplicateSlugs(entries: Pick<Entry, 'slug'>[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { slug } of entries) {
    if (seen.has(slug)) duplicates.add(slug);
    seen.add(slug);
  }
  return [...duplicates];
}
