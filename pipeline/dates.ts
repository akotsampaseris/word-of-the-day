/**
 * Date helpers. All dates in this project are plain "YYYY-MM-DD" strings.
 * ISO date strings sort correctly as text, so "2026-09-24" < "2026-09-25"
 * works as a comparison.
 *
 * "Today" depends on a time zone (the site's SITE_TIMEZONE), so it is always
 * computed explicitly rather than from the machine's local clock.
 */
import { IsoDateSchema } from './schema';

const FILENAME_PATTERN = /^(\d{4}-\d{2}-\d{2})\.json$/;

export function isIsoDate(value: string): boolean {
  return IsoDateSchema.safeParse(value).success;
}

/** Today's date in the given IANA time zone, e.g. todayIn('Europe/Athens'). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** addDays('2026-12-31', 1) === '2027-01-01'. Calculated in UTC, so no DST surprises. */
export function addDays(isoDate: string, days: number): string {
  if (!isIsoDate(isoDate)) throw new Error(`Not a valid YYYY-MM-DD date: "${isoDate}"`);
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Every date from `start` to `end`, inclusive. Empty if end < start. */
export function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

export function filenameForDate(date: string): string {
  if (!isIsoDate(date)) throw new Error(`Not a valid YYYY-MM-DD date: "${date}"`);
  return `${date}.json`;
}

/** "2026-09-25.json" → "2026-09-25". Anything else (e.g. words.json) → null. */
export function dateFromFilename(filename: string): string | null {
  const match = FILENAME_PATTERN.exec(filename);
  if (!match || !isIsoDate(match[1]!)) return null;
  return match[1]!;
}
