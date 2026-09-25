/**
 * The checks behind `pipeline:validate` and `pipeline:approve`.
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  loadContent,
  loadContentFile,
  readWordQueue,
  updateContentFile,
  type ContentFile,
} from './content-store';
import { filenameForDate, isIsoDate } from './dates';
import { WORDS_FILE } from './paths';
import { checkContentRules } from './rules';
import type { Entry } from './schema';
import { slugify } from './slug';

export interface FileReport {
  file: string;
  messages: string[];
}

export interface ValidationReport {
  checked: number;
  errors: FileReport[];
  warnings: FileReport[];
}

/** Checks one valid-schema entry against everything the schema can't express. */
export function checkEntry(entry: Entry, fileDate: string): string[] {
  const errors: string[] = [];
  if (entry.date !== fileDate) {
    errors.push(`date: is ${entry.date} but the filename says ${fileDate}.`);
  }
  if (entry.slug !== slugify(entry.word)) {
    errors.push(`slug: is "${entry.slug}" but should be "${slugify(entry.word)}" for the word "${entry.word}".`);
  }
  errors.push(...checkContentRules(entry));
  return errors;
}

/** Re-checks every file in the content directory. */
export async function validateContentDir(contentDir: string): Promise<ValidationReport> {
  const files = await loadContent(contentDir);
  const report: ValidationReport = { checked: files.length, errors: [], warnings: [] };
  const addError = (file: string, messages: string[]) => {
    if (messages.length > 0) report.errors.push({ file, messages });
  };

  for (const file of files) {
    if (file.kind === 'invalid') addError(file.filename, file.errors);
    if (file.kind === 'failed') addError(file.filename, failedDraftMessages(file));
    if (file.kind === 'entry') addError(file.filename, checkEntry(file.entry, file.date));
  }

  // Each slug is a permalink (/word/<slug>), so it must be unique.
  for (const [slug, filenames] of slugOwners(files)) {
    if (filenames.length > 1) {
      for (const filename of filenames) {
        addError(filename, [`slug: "${slug}" is also used by ${filenames.filter((f) => f !== filename).join(', ')}.`]);
      }
    }
  }

  // The word queue.
  try {
    const queue = await readWordQueue(contentDir);
    const seen = new Set<string>();
    const repeated = queue.filter((word) => {
      const slug = slugify(word);
      const isRepeat = seen.has(slug);
      seen.add(slug);
      return isRepeat;
    });
    if (repeated.length > 0) {
      report.warnings.push({ file: WORDS_FILE, messages: [`listed more than once: ${repeated.join(', ')}`] });
    }
  } catch (error) {
    addError(WORDS_FILE, [(error as Error).message]);
  }

  // Anything else in content/ is probably a typo'd filename.
  const stray = (await readdir(contentDir)).filter(
    (name) => name !== WORDS_FILE && !files.some((file) => file.filename === name),
  );
  for (const name of stray) {
    report.warnings.push({ file: name, messages: ['not a YYYY-MM-DD.json content file; ignored by the pipeline and the site'] });
  }

  return report;
}

export type ApproveResult =
  | { ok: true; alreadyApproved: boolean; entry: Entry }
  | { ok: false; errors: string[] };

/** Flips one entry's status to "approved", after re-running every check. */
export async function approveEntry(contentDir: string, date: string): Promise<ApproveResult> {
  if (!isIsoDate(date)) return { ok: false, errors: [`"${date}" is not a valid YYYY-MM-DD date.`] };

  const filename = filenameForDate(date);
  if (!existsSync(path.join(contentDir, filename))) {
    return { ok: false, errors: [`content/${filename} does not exist.`] };
  }

  const file = await loadContentFile(contentDir, filename);
  if (file.kind === 'failed') return { ok: false, errors: failedDraftMessages(file) };
  if (file.kind === 'invalid') return { ok: false, errors: file.errors };

  const errors = checkEntry(file.entry, file.date);
  const others = (await loadContent(contentDir)).filter((other) => other.filename !== filename);
  const clash = slugOwners(others).get(file.entry.slug);
  if (clash) errors.push(`slug: "${file.entry.slug}" is already used by ${clash.join(', ')}.`);
  if (errors.length > 0) return { ok: false, errors };

  if (file.entry.status === 'approved') return { ok: true, alreadyApproved: true, entry: file.entry };

  const approved: Entry = { ...file.entry, status: 'approved' };
  await updateContentFile(contentDir, approved);
  return { ok: true, alreadyApproved: false, entry: approved };
}

function failedDraftMessages(file: Extract<ContentFile, { kind: 'failed' }>): string[] {
  return [
    'generation failed. Fix the fields by hand and delete "_errors" (or delete the file to regenerate it). Last errors:',
    ...file.draft._errors.map((error) => `  ${error}`),
  ];
}

function slugOwners(files: ContentFile[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const file of files) {
    const slug = file.kind === 'entry' ? file.entry.slug : file.kind === 'failed' ? file.draft.slug : undefined;
    if (slug === undefined) continue;
    owners.set(slug, [...(owners.get(slug) ?? []), file.filename]);
  }
  return owners;
}
