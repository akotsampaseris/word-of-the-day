import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateFromFilename,
  dateRange,
  filenameForDate,
  isValidTimeZone,
  todayIn,
} from '../pipeline/dates';
import { findDuplicateSlugs, pickFeatured, selectPublished } from '../pipeline/publish';
import { slugify } from '../pipeline/slug';
import { validEntry } from './helpers';

describe('slugify', () => {
  it.each([
    ['gongoozler', 'gongoozler'],
    ['Zugzwang', 'zugzwang'],
    ["Will-o'-the-wisp", 'will-o-the-wisp'],
    ['naïveté', 'naivete'],
    ['  two   words ', 'two-words'],
    ['déjà vu!', 'deja-vu'],
  ])('%s → %s', (word, slug) => {
    expect(slugify(word)).toBe(slug);
  });
});

describe('todayIn', () => {
  // 22:30 UTC on 25 September: already the 26th in Athens, still the 25th in LA.
  const lateEvening = new Date('2026-09-25T22:30:00Z');

  it('uses the given time zone, not the machine clock', () => {
    expect(todayIn('UTC', lateEvening)).toBe('2026-09-25');
    expect(todayIn('Europe/Athens', lateEvening)).toBe('2026-09-26');
    expect(todayIn('America/Los_Angeles', lateEvening)).toBe('2026-09-25');
  });

  it('validates time zone names', () => {
    expect(isValidTimeZone('Europe/Athens')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});

describe('addDays and dateRange', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('is not affected by daylight saving changes', () => {
    // Europe switches clocks on 25 October 2026; plain dates must not notice.
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('rejects malformed dates', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(/Not a valid/);
  });

  it('builds inclusive ranges', () => {
    expect(dateRange('2026-09-29', '2026-10-02')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
    expect(dateRange('2026-09-25', '2026-09-25')).toEqual(['2026-09-25']);
    expect(dateRange('2026-09-26', '2026-09-25')).toEqual([]);
  });
});

describe('content filenames', () => {
  it('maps dates to filenames and back', () => {
    expect(filenameForDate('2026-09-25')).toBe('2026-09-25.json');
    expect(dateFromFilename('2026-09-25.json')).toBe('2026-09-25');
  });

  it.each(['words.json', '2026-09-25.json.bak', '2026-02-30.json', '2026-9-25.json'])(
    'ignores "%s"',
    (filename) => {
      expect(dateFromFilename(filename)).toBeNull();
    },
  );
});

describe('the publish rule', () => {
  const entries = [
    validEntry({ date: '2026-09-23', slug: 'a', status: 'approved' }),
    validEntry({ date: '2026-09-24', slug: 'b', status: 'draft' }),
    validEntry({ date: '2026-09-25', slug: 'c', status: 'approved' }),
    validEntry({ date: '2026-09-26', slug: 'd', status: 'approved' }),
  ];

  it('publishes approved entries up to and including today, newest first', () => {
    expect(selectPublished(entries, '2026-09-25').map((e) => e.slug)).toEqual(['c', 'a']);
  });

  it('never publishes drafts or future-dated entries', () => {
    const slugs = selectPublished(entries, '2026-09-25').map((e) => e.slug);
    expect(slugs).not.toContain('b');
    expect(slugs).not.toContain('d');
  });

  it("features today's entry when it is approved", () => {
    expect(pickFeatured(entries, '2026-09-25')?.slug).toBe('c');
  });

  it('falls back to the most recent published entry when today has none', () => {
    // 24th is only a draft, so the 23rd is featured.
    expect(pickFeatured(entries, '2026-09-24')?.slug).toBe('a');
  });

  it('returns undefined when nothing is published yet', () => {
    expect(pickFeatured(entries, '2026-09-01')).toBeUndefined();
  });

  it('finds duplicate slugs', () => {
    expect(findDuplicateSlugs([{ slug: 'a' }, { slug: 'b' }, { slug: 'a' }])).toEqual(['a']);
    expect(findDuplicateSlugs([{ slug: 'a' }, { slug: 'b' }])).toEqual([]);
  });
});
