/**
 * Reading and writing content/*.json. The filesystem is the database:
 * one file per day, named by date, committed to git.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dateFromFilename, filenameForDate } from './dates';
import { WORDS_FILE } from './paths';
import {
  EntrySchema,
  FailedDraftSchema,
  formatZodIssues,
  type Entry,
  type FailedDraft,
} from './schema';
import { slugify } from './slug';

/** A content file, classified by what it contains. */
export type ContentFile =
  | { kind: 'entry'; filename: string; date: string; entry: Entry }
  | { kind: 'failed'; filename: string; date: string; draft: FailedDraft }
  | { kind: 'invalid'; filename: string; date: string; errors: string[] };

/** Loads every YYYY-MM-DD.json file in the directory, sorted by date. */
export async function loadContent(contentDir: string): Promise<ContentFile[]> {
  const filenames = (await readdir(contentDir)).filter((name) => dateFromFilename(name) !== null).sort();
  return Promise.all(filenames.map((filename) => loadContentFile(contentDir, filename)));
}

export async function loadContentFile(contentDir: string, filename: string): Promise<ContentFile> {
  const date = dateFromFilename(filename);
  if (date === null) throw new Error(`Not a content filename: ${filename}`);

  let data: unknown;
  try {
    data = JSON.parse(await readFile(path.join(contentDir, filename), 'utf8'));
  } catch (error) {
    return { kind: 'invalid', filename, date, errors: [`not valid JSON: ${(error as Error).message}`] };
  }

  const entry = EntrySchema.safeParse(data);
  if (entry.success) return { kind: 'entry', filename, date, entry: entry.data };

  const failed = FailedDraftSchema.safeParse(data);
  if (failed.success) return { kind: 'failed', filename, date, draft: failed.data };

  return { kind: 'invalid', filename, date, errors: formatZodIssues(entry.error) };
}

/** The valid entries only. */
export function entriesOf(files: ContentFile[]): Entry[] {
  return files.flatMap((file) => (file.kind === 'entry' ? [file.entry] : []));
}

/**
 * Writes a new content file. Refuses to overwrite an existing one (the 'wx'
 * flag), so two runs can never silently replace each other's work.
 */
export async function createContentFile(contentDir: string, data: Entry | FailedDraft): Promise<string> {
  const file = path.join(contentDir, filenameForDate(data.date));
  await writeFile(file, toJson(data), { flag: 'wx' });
  return file;
}

/** Overwrites an existing content file (used by `approve`). */
export async function updateContentFile(contentDir: string, entry: Entry): Promise<string> {
  const file = path.join(contentDir, filenameForDate(entry.date));
  await writeFile(file, toJson(entry), { flag: 'w' });
  return file;
}

/** Reads content/words.json: a JSON array of words, in the order they should be used. */
export async function readWordQueue(contentDir: string): Promise<string[]> {
  const file = path.join(contentDir, WORDS_FILE);
  const data: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(data) || !data.every((word) => typeof word === 'string' && word.trim() !== '')) {
    throw new Error(`${WORDS_FILE} must be a JSON array of non-empty strings.`);
  }
  return data.map((word: string) => word.trim());
}

/** Slugs that already have a content file (valid, failed, or otherwise). */
export function usedSlugs(files: ContentFile[]): Set<string> {
  const slugs = new Set<string>();
  for (const file of files) {
    if (file.kind === 'entry') slugs.add(file.entry.slug);
    if (file.kind === 'failed') slugs.add(file.draft.slug);
  }
  return slugs;
}

/**
 * The words still waiting to be used, in queue order. A word counts as used
 * once any content file has its slug, so words.json never needs editing by
 * the pipeline, and deleting a content file puts its word back in the queue.
 */
export function unusedWords(queue: string[], used: Set<string>): string[] {
  const seen = new Set(used);
  const result: string[] = [];
  for (const word of queue) {
    const slug = slugify(word);
    if (seen.has(slug)) continue;
    seen.add(slug);
    result.push(word);
  }
  return result;
}

function toJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}
