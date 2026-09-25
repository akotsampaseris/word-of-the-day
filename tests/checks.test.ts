import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { approveEntry, validateContentDir } from '../pipeline/checks';
import { ensureMockImages } from '../pipeline/mock-assets';
import { buildStatus } from '../pipeline/status';
import { validEntry } from './helpers';
import { makeContentDir } from './pipeline-helpers';

const failedDraft = {
  slug: 'velleity',
  word: 'velleity',
  date: '2026-09-26',
  status: 'draft',
  _errors: ['story: has 90 words; it must have between 120 and 200.'],
  generatedAt: '2026-09-11T06:00:00.000Z',
};

describe('validateContentDir', () => {
  it('passes a directory of valid entries', async () => {
    const dir = await makeContentDir(['gongoozler'], { '2026-09-25.json': validEntry() });
    expect(await validateContentDir(dir)).toEqual({ checked: 1, errors: [], warnings: [] });
  });

  it('reports every kind of problem with the file it came from', async () => {
    const dir = await makeContentDir(['gongoozler', 'Gongoozler'], {
      '2026-09-20.json': '{ not json',
      '2026-09-21.json': { ...validEntry(), definition: undefined },
      '2026-09-22.json': validEntry({ date: '2026-09-22', slug: 'wrong-slug' }),
      '2026-09-23.json': validEntry({ date: '2026-09-24', slug: 'widdershins', word: 'widdershins' }),
      '2026-09-25.json': validEntry({ date: '2026-09-25', story: 'Short — and missing the word.' }),
      '2026-09-26.json': failedDraft,
      '2026-09-27.json': validEntry({ date: '2026-09-27' }),
      'notes.txt': 'hello',
    });

    const report = await validateContentDir(dir);
    const errorsFor = (file: string) => report.errors.filter((e) => e.file === file).flatMap((e) => e.messages);

    expect(errorsFor('2026-09-20.json')).toEqual([expect.stringMatching(/not valid JSON/)]);
    expect(errorsFor('2026-09-21.json')).toEqual([expect.stringMatching(/^definition:/)]);
    expect(errorsFor('2026-09-22.json')).toEqual([expect.stringMatching(/slug: is "wrong-slug" but should be "gongoozler"/)]);
    expect(errorsFor('2026-09-23.json')).toContainEqual(
      expect.stringMatching(/date: is 2026-09-24 but the filename says 2026-09-23/),
    );
    expect(errorsFor('2026-09-25.json')).toEqual(
      expect.arrayContaining([expect.stringMatching(/em-dash/), expect.stringMatching(/must use the word/)]),
    );
    expect(errorsFor('2026-09-25.json')).toContainEqual(expect.stringMatching(/also used by 2026-09-27.json/));
    expect(errorsFor('2026-09-26.json')[0]).toMatch(/generation failed/);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        { file: 'words.json', messages: ['listed more than once: Gongoozler'] },
        { file: 'notes.txt', messages: [expect.stringMatching(/not a YYYY-MM-DD.json/)] },
      ]),
    );
  });
});

describe('approveEntry', () => {
  it('flips a valid draft to approved and leaves everything else unchanged', async () => {
    const draft = validEntry({ status: 'draft' });
    const dir = await makeContentDir(['gongoozler'], { '2026-09-25.json': draft });

    const result = await approveEntry(dir, '2026-09-25');

    expect(result).toMatchObject({ ok: true, alreadyApproved: false });
    const saved = JSON.parse(await readFile(path.join(dir, '2026-09-25.json'), 'utf8'));
    expect(saved).toEqual({ ...draft, status: 'approved' });
  });

  it('says so when the entry is already approved', async () => {
    const dir = await makeContentDir([], { '2026-09-25.json': validEntry() });
    expect(await approveEntry(dir, '2026-09-25')).toMatchObject({ ok: true, alreadyApproved: true });
  });

  it('refuses a failed draft', async () => {
    const dir = await makeContentDir([], { '2026-09-26.json': failedDraft });
    const result = await approveEntry(dir, '2026-09-26');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatch(/generation failed/);
  });

  it('refuses an entry that breaks a content rule (e.g. edited by hand)', async () => {
    const dir = await makeContentDir([], {
      '2026-09-25.json': validEntry({ status: 'draft', story: validEntry().story.replace('. ', ' — ') }),
    });
    const result = await approveEntry(dir, '2026-09-25');
    expect(result).toEqual({ ok: false, errors: [expect.stringMatching(/em-dash/)] });
    const saved = JSON.parse(await readFile(path.join(dir, '2026-09-25.json'), 'utf8'));
    expect(saved.status).toBe('draft');
  });

  it('refuses a slug already used by another day', async () => {
    const dir = await makeContentDir([], {
      '2026-09-24.json': validEntry({ date: '2026-09-24' }),
      '2026-09-25.json': validEntry({ status: 'draft' }),
    });
    const result = await approveEntry(dir, '2026-09-25');
    expect(result).toEqual({ ok: false, errors: [expect.stringMatching(/already used by 2026-09-24.json/)] });
  });

  it('refuses a missing file or a malformed date', async () => {
    const dir = await makeContentDir([]);
    expect(await approveEntry(dir, '2026-09-25')).toEqual({ ok: false, errors: [expect.stringMatching(/does not exist/)] });
    expect(await approveEntry(dir, '25-09-2026')).toEqual({ ok: false, errors: [expect.stringMatching(/not a valid/)] });
  });
});

describe('buildStatus', () => {
  it('summarises the buffer', async () => {
    const dir = await makeContentDir(['gongoozler', 'velleity', 'widdershins', 'zugzwang'], {
      '2026-09-24.json': validEntry({ date: '2026-09-24', slug: 'old', word: 'old', status: 'draft' }),
      '2026-09-25.json': validEntry({ date: '2026-09-25', status: 'approved' }),
      '2026-09-26.json': failedDraft,
      '2026-09-27.json': validEntry({ date: '2026-09-27', slug: 'widdershins', word: 'widdershins', status: 'draft' }),
    });

    const report = await buildStatus(dir, '2026-09-25', 3);

    expect(report.days.map((day) => day.state)).toEqual(['approved', 'failed', 'draft', 'missing']);
    expect(report.approvedDays).toBe(1);
    expect(report.generatedDays).toBe(3);
    expect(report.awaitingReview).toEqual([{ date: '2026-09-27', word: 'widdershins' }]);
    expect(report.staleDrafts).toEqual([{ date: '2026-09-24', word: 'old' }]);
    expect(report.failed).toEqual([{ date: '2026-09-26', word: 'velleity' }]);
    expect(report.gaps).toEqual(['2026-09-28']);
    expect(report.wordsRemaining).toBe(1); // only zugzwang is unused
    expect(report.lastPublished).toEqual({ date: '2026-09-25', word: 'gongoozler' });
  });
});

describe('ensureMockImages', () => {
  it('recreates missing mock images and leaves real image URLs alone', async () => {
    const mockEntry = validEntry({ date: '2026-09-24', slug: 'velleity', word: 'velleity' });
    mockEntry.image = { ...mockEntry.image, url: '/mock-images/2026-09-24-velleity-abc.svg', provider: 'mock' };
    const dir = await makeContentDir([], {
      '2026-09-24.json': mockEntry,
      '2026-09-25.json': validEntry(),
    });
    const imagesDir = await mkdtemp(path.join(os.tmpdir(), 'wotd-mock-images-'));

    expect(await ensureMockImages(dir, imagesDir)).toBe(1);
    expect(await readFile(path.join(imagesDir, '2026-09-24-velleity-abc.svg'), 'utf8')).toContain('>velleity</text>');
    expect(await ensureMockImages(dir, imagesDir)).toBe(0); // idempotent
  });
});
