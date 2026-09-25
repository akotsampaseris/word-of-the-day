/**
 * `pipeline:status`: how healthy is the buffer?
 */
import {
  entriesOf,
  loadContent,
  readWordQueue,
  unusedWords,
  usedSlugs,
  type ContentFile,
} from './content-store';
import { addDays, dateRange } from './dates';
import { selectPublished } from './publish';

export type DayState = 'approved' | 'draft' | 'failed' | 'invalid' | 'missing';

export interface StatusReport {
  today: string;
  windowEnd: string;
  days: { date: string; state: DayState; word?: string }[];
  /** Consecutive days from today that are approved: how long the site runs untouched. */
  approvedDays: number;
  /** Consecutive days from today that have any content file. */
  generatedDays: number;
  awaitingReview: { date: string; word: string }[];
  /** Drafts dated before today: they were never published and never will be. */
  staleDrafts: { date: string; word: string }[];
  failed: { date: string; word: string }[];
  invalid: string[];
  gaps: string[];
  wordsRemaining: number;
  lastPublished: { date: string; word: string } | undefined;
}

export async function buildStatus(contentDir: string, today: string, bufferDays: number): Promise<StatusReport> {
  const files = await loadContent(contentDir);
  const byDate = new Map(files.map((file) => [file.date, file]));
  const windowEnd = addDays(today, bufferDays);

  const days = dateRange(today, windowEnd).map((date) => describeDay(date, byDate.get(date)));
  const drafts = files.flatMap((file) =>
    file.kind === 'entry' && file.entry.status === 'draft' ? [{ date: file.date, word: file.entry.word }] : [],
  );
  const published = selectPublished(entriesOf(files), today)[0];

  return {
    today,
    windowEnd,
    days,
    approvedDays: countLeading(days, (day) => day.state === 'approved'),
    generatedDays: countLeading(days, (day) => day.state !== 'missing'),
    awaitingReview: drafts.filter((draft) => draft.date >= today),
    staleDrafts: drafts.filter((draft) => draft.date < today),
    failed: files.flatMap((file) => (file.kind === 'failed' ? [{ date: file.date, word: file.draft.word }] : [])),
    invalid: files.flatMap((file) => (file.kind === 'invalid' ? [file.filename] : [])),
    gaps: days.filter((day) => day.state === 'missing').map((day) => day.date),
    wordsRemaining: unusedWords(await readWordQueue(contentDir), usedSlugs(files)).length,
    lastPublished: published ? { date: published.date, word: published.word } : undefined,
  };
}

export function formatStatus(report: StatusReport): string {
  const lines = [
    `Today: ${report.today}   Window: ${report.today} → ${report.windowEnd}`,
    `Last published: ${report.lastPublished ? `${report.lastPublished.date} (${report.lastPublished.word})` : 'nothing yet'}`,
    `Approved buffer:  ${report.approvedDays} day(s) from today`,
    `Generated buffer: ${report.generatedDays} day(s) from today`,
    `Words left in queue: ${report.wordsRemaining}`,
    '',
    ...report.days.map((day) => `  ${day.date}  ${day.state.padEnd(8)}  ${day.word ?? ''}`.trimEnd()),
    '',
  ];

  const list = (title: string, items: string[]) => {
    if (items.length > 0) lines.push(`${title} (${items.length}):`, ...items.map((item) => `  ${item}`), '');
  };
  list('Drafts awaiting review', report.awaitingReview.map((d) => `${d.date}  ${d.word}`));
  list('Failed drafts (need a human)', report.failed.map((d) => `${d.date}  ${d.word}`));
  list('Invalid files', report.invalid);
  list('Stale drafts (dated in the past, never published)', report.staleDrafts.map((d) => `${d.date}  ${d.word}`));
  list('Gaps in the window', report.gaps);
  if (report.wordsRemaining < 14) lines.push(`Warning: only ${report.wordsRemaining} unused words left in words.json.`);

  return lines.join('\n').trimEnd();
}

function describeDay(date: string, file: ContentFile | undefined): StatusReport['days'][number] {
  if (!file) return { date, state: 'missing' };
  if (file.kind === 'entry') return { date, state: file.entry.status, word: file.entry.word };
  if (file.kind === 'failed') return { date, state: 'failed', word: file.draft.word };
  return { date, state: 'invalid' };
}

function countLeading<T>(items: T[], predicate: (item: T) => boolean): number {
  const index = items.findIndex((item) => !predicate(item));
  return index === -1 ? items.length : index;
}
