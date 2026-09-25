/**
 * Turns a word into its URL slug: "Will-o'-the-wisp" → "will-o-the-wisp",
 * "naïveté" → "naivete". The slug is also how the pipeline recognises a word
 * as already used, so it must be stable.
 */
export function slugify(word: string): string {
  return word
    .normalize('NFKD') // split accented letters into letter + accent mark
    .replace(/[̀-ͯ]/g, '') // drop the accent marks
    .toLowerCase()
    .replace(/['’]/g, '') // apostrophes vanish rather than becoming hyphens
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
