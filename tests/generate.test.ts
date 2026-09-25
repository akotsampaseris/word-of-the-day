import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chooseStyleAnchors,
  fillBuffer,
  formatRunSummary,
  generateTextWithRepair,
  type PipelineDeps,
} from '../pipeline/generate';
import { createMockImageProvider } from '../pipeline/providers/image-mock';
import { createMockSourceProvider } from '../pipeline/providers/source-mock';
import { createMockTextProvider } from '../pipeline/providers/text-mock';
import { EntrySchema, FailedDraftSchema } from '../pipeline/schema';
import { createLocalImageStore } from '../pipeline/storage/local';
import { REFERENCE_INSTRUCTION, STYLE_PREAMBLE } from '../pipeline/style';
import { VALID_STORY, validEntry, validTextOutput } from './helpers';
import {
  makeContentDir,
  recordingImageProvider,
  scriptedTextProvider,
  sourceProviderWithout,
} from './pipeline-helpers';

const GOOD = JSON.stringify(validTextOutput()); // valid for the word "gongoozler"
const WITH_EM_DASH = JSON.stringify(validTextOutput({ story: validTextOutput().story.replace('. ', ' — ') }));
const TOO_LONG_DEFINITION = JSON.stringify(validTextOutput({ definition: 'x'.repeat(301) }));
const NOT_JSON = 'Sure! Here is the entry you asked for.';

/** A valid model reply for any word (the fixture story, with the word swapped in). */
function goodReplyFor(word: string): string {
  return JSON.stringify(validTextOutput({ story: VALID_STORY.replace('gongoozler', word) }));
}

async function source() {
  return (await createMockSourceProvider().fetch('gongoozler'))!;
}

describe('generateTextWithRepair (the retry/repair loop)', () => {
  it('returns on the first attempt when the output is valid', async () => {
    const { provider, requests } = scriptedTextProvider([GOOD]);
    const result = await generateTextWithRepair({ provider, word: 'gongoozler', source: await source(), seed: 1, maxAttempts: 3 });
    expect(result).toMatchObject({ ok: true, attempts: 1 });
    expect(requests).toHaveLength(1);
  });

  it('accepts JSON wrapped in markdown fences', async () => {
    const { provider } = scriptedTextProvider(['```json\n' + GOOD + '\n```']);
    const result = await generateTextWithRepair({ provider, word: 'gongoozler', source: await source(), seed: 1, maxAttempts: 3 });
    expect(result.ok).toBe(true);
  });

  it('feeds the specific validation error back, then succeeds', async () => {
    const { provider, requests } = scriptedTextProvider([WITH_EM_DASH, GOOD]);
    const result = await generateTextWithRepair({ provider, word: 'gongoozler', source: await source(), seed: 1, maxAttempts: 3 });

    expect(result).toMatchObject({ ok: true, attempts: 2 });
    const second = requests[1]!.messages;
    expect(second).toHaveLength(3);
    expect(second[1]).toEqual({ role: 'assistant', content: WITH_EM_DASH });
    expect(second[2]!.role).toBe('user');
    expect(second[2]!.content).toContain('story: contains 1 em-dash');
    expect(second[2]!.content).toContain('Reply again with the complete, corrected JSON object');
  });

  it('reports a JSON parse failure as a repairable error', async () => {
    const { provider, requests } = scriptedTextProvider([NOT_JSON, GOOD]);
    const result = await generateTextWithRepair({ provider, word: 'gongoozler', source: await source(), seed: 1, maxAttempts: 3 });
    expect(result.ok).toBe(true);
    expect(requests[1]!.messages[2]!.content).toContain('was not valid JSON');
  });

  it('lists schema errors and rule errors together in one repair prompt', async () => {
    const bad = JSON.stringify(validTextOutput({ definition: 'x'.repeat(301), story: 'Far too short — really.' }));
    const { provider, requests } = scriptedTextProvider([bad, GOOD]);
    await generateTextWithRepair({ provider, word: 'gongoozler', source: await source(), seed: 1, maxAttempts: 3 });
    const repair = requests[1]!.messages[2]!.content;
    expect(repair).toContain('definition: Too big');
    expect(repair).toContain('story: must use the word');
    expect(repair).toContain('story: contains 1 em-dash');
    expect(repair).toContain('story: has 4 words');
  });

  it('gives up after maxAttempts and returns the last errors and output', async () => {
    const { provider, requests } = scriptedTextProvider([NOT_JSON, WITH_EM_DASH, TOO_LONG_DEFINITION, GOOD]);
    const result = await generateTextWithRepair({ provider, word: 'gongoozler', source: await source(), seed: 1, maxAttempts: 3 });

    expect(requests).toHaveLength(3); // the fourth, good reply is never requested
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.attempts).toBe(3);
    expect(result.errors).toEqual([expect.stringMatching(/^definition: Too big/)]);
    expect(result.lastValue).toMatchObject({ definition: 'x'.repeat(301) });
  });

  it('respects maxAttempts = 1', async () => {
    const { provider, requests } = scriptedTextProvider([NOT_JSON, GOOD]);
    const result = await generateTextWithRepair({ provider, word: 'gongoozler', source: await source(), seed: 1, maxAttempts: 1 });
    expect(result.ok).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it('sends the fetched source material and forbids inventing etymology', async () => {
    const { provider, requests } = scriptedTextProvider([GOOD]);
    await generateTextWithRepair({ provider, word: 'gongoozler', source: await source(), seed: 1, maxAttempts: 3 });
    const prompt = requests[0]!.messages[0]!.content;
    expect(prompt).toContain('https://example.invalid/mock-source/gongoozler');
    expect(prompt).toContain('Use only facts stated in the source material');
  });
});

describe('fillBuffer', () => {
  function mockDeps(contentDir: string, imagesDir: string, overrides: Partial<PipelineDeps> = {}): PipelineDeps {
    return {
      text: createMockTextProvider(),
      image: createMockImageProvider(),
      source: createMockSourceProvider(),
      store: createLocalImageStore(imagesDir),
      contentDir,
      now: () => new Date('2026-09-25T06:00:00Z'),
      ...overrides,
    };
  }

  it('fills today through today + bufferDays in mock mode, in queue order', async () => {
    const dir = await makeContentDir(['gongoozler', 'velleity', 'widdershins', 'zugzwang']);
    const imagesDir = path.join(dir, 'images');
    const summary = await fillBuffer(mockDeps(dir, imagesDir), { today: '2026-09-25', bufferDays: 2, maxAttempts: 3 });

    expect(summary.created).toEqual([
      { date: '2026-09-25', word: 'gongoozler' },
      { date: '2026-09-26', word: 'velleity' },
      { date: '2026-09-27', word: 'widdershins' },
    ]);
    const entry = EntrySchema.parse(JSON.parse(await readFile(path.join(dir, '2026-09-26.json'), 'utf8')));
    expect(entry).toMatchObject({ slug: 'velleity', status: 'draft', generatedAt: '2026-09-25T06:00:00.000Z' });
    expect(entry.image.url).toMatch(/^\/mock-images\/2026-09-26-velleity-[0-9a-f]{10}\.svg$/);
    expect(entry.image.prompt.startsWith(STYLE_PREAMBLE)).toBe(true);
    expect(await readdir(imagesDir)).toHaveLength(3);
  });

  it('never touches existing dates and never reuses a word', async () => {
    const existing = validEntry({ date: '2026-09-26', slug: 'gongoozler', word: 'gongoozler', status: 'draft' });
    const dir = await makeContentDir(['gongoozler', 'velleity', 'widdershins'], { '2026-09-26.json': existing });
    const before = await readFile(path.join(dir, '2026-09-26.json'), 'utf8');

    const summary = await fillBuffer(mockDeps(dir, path.join(dir, 'images')), {
      today: '2026-09-25',
      bufferDays: 2,
      maxAttempts: 3,
    });

    expect(summary.created).toEqual([
      { date: '2026-09-25', word: 'velleity' },
      { date: '2026-09-27', word: 'widdershins' },
    ]);
    expect(await readFile(path.join(dir, '2026-09-26.json'), 'utf8')).toBe(before);
  });

  it('writes a failed draft with _errors after 3 failures, skips the image, and continues', async () => {
    const dir = await makeContentDir(['gongoozler', 'velleity']);
    const { provider } = scriptedTextProvider([
      WITH_EM_DASH,
      WITH_EM_DASH,
      WITH_EM_DASH, // three strikes for "gongoozler" on the 25th
      goodReplyFor('velleity'), // the run carries on with the next word on the 26th
    ]);
    const images = recordingImageProvider({ supportsReferenceImages: false });

    const summary = await fillBuffer(
      mockDeps(dir, path.join(dir, 'images'), { text: provider, image: images.provider }),
      { today: '2026-09-25', bufferDays: 1, maxAttempts: 3 },
    );

    expect(summary.failed).toEqual([{ date: '2026-09-25', word: 'gongoozler', errors: [expect.stringMatching(/em-dash/)] }]);
    expect(summary.created).toEqual([{ date: '2026-09-26', word: 'velleity' }]);
    expect(images.requests.map((request) => request.word)).toEqual(['velleity']);

    const failed = JSON.parse(await readFile(path.join(dir, '2026-09-25.json'), 'utf8'));
    expect(FailedDraftSchema.safeParse(failed).success).toBe(true);
    expect(EntrySchema.safeParse(failed).success).toBe(false);
    expect(failed).toMatchObject({ status: 'draft', word: 'gongoozler', definition: validTextOutput().definition });
    expect(failed.image).toBeUndefined();
  });

  it('keeps the raw reply when the last attempt was not even JSON', async () => {
    const dir = await makeContentDir(['gongoozler']);
    const { provider } = scriptedTextProvider([NOT_JSON, NOT_JSON, NOT_JSON]);
    await fillBuffer(mockDeps(dir, path.join(dir, 'images'), { text: provider }), {
      today: '2026-09-25',
      bufferDays: 0,
      maxAttempts: 3,
    });
    const failed = JSON.parse(await readFile(path.join(dir, '2026-09-25.json'), 'utf8'));
    expect(failed._lastResponse).toBe(NOT_JSON);
  });

  it('skips a word with no etymology source and gives its date to the next word', async () => {
    const dir = await makeContentDir(['gongoozler', 'velleity']);
    const summary = await fillBuffer(
      mockDeps(dir, path.join(dir, 'images'), { source: sourceProviderWithout(['gongoozler']) }),
      { today: '2026-09-25', bufferDays: 0, maxAttempts: 3 },
    );
    expect(summary.skipped).toEqual([{ word: 'gongoozler', reason: expect.stringContaining('no usable etymology') }]);
    expect(summary.created).toEqual([{ date: '2026-09-25', word: 'velleity' }]);
  });

  it('stops the run when a provider throws, keeping what was already written', async () => {
    const dir = await makeContentDir(['gongoozler', 'velleity', 'widdershins']);
    const { provider } = scriptedTextProvider([
      JSON.stringify(validTextOutput()),
      new Error('503 Service Unavailable'),
    ]);
    const summary = await fillBuffer(mockDeps(dir, path.join(dir, 'images'), { text: provider }), {
      today: '2026-09-25',
      bufferDays: 2,
      maxAttempts: 3,
    });

    expect(summary.created).toEqual([{ date: '2026-09-25', word: 'gongoozler' }]);
    expect(summary.aborted).toEqual({ date: '2026-09-26', word: 'velleity', error: '503 Service Unavailable' });
    expect(summary.unfilled).toEqual(['2026-09-26', '2026-09-27']);
    expect((await readdir(dir)).sort()).toEqual(['2026-09-25.json', 'images', 'words.json']);
  });

  it('reports dates left empty when the word queue runs out', async () => {
    const dir = await makeContentDir(['gongoozler']);
    const summary = await fillBuffer(mockDeps(dir, path.join(dir, 'images')), {
      today: '2026-09-25',
      bufferDays: 2,
      maxAttempts: 3,
    });
    expect(summary.unfilled).toEqual(['2026-09-26', '2026-09-27']);
    expect(formatRunSummary(summary, { today: '2026-09-25', bufferDays: 2, providers: [] })).toContain(
      'Dates still empty (2)',
    );
  });

  it('passes the 3 most recent approved real images as style anchors when supported', async () => {
    const approved = (date: string, slug: string, url: string, provider = 'fal') =>
      validEntry({ date, slug, word: slug, image: { ...validEntry().image, url, provider } });
    const dir = await makeContentDir(['velleity'], {
      '2026-09-20.json': approved('2026-09-20', 'a', 'https://img.example.com/a.jpg'),
      '2026-09-21.json': approved('2026-09-21', 'b', 'https://img.example.com/b.jpg'),
      '2026-09-22.json': approved('2026-09-22', 'c', 'https://img.example.com/c.jpg'),
      '2026-09-23.json': approved('2026-09-23', 'd', 'https://img.example.com/d.jpg'),
      '2026-09-24.json': approved('2026-09-24', 'e', '/mock-images/e.svg', 'mock'),
    });
    const images = recordingImageProvider({ supportsReferenceImages: true });

    await fillBuffer(mockDeps(dir, path.join(dir, 'images'), { image: images.provider }), {
      today: '2026-09-25',
      bufferDays: 0,
      maxAttempts: 3,
    });

    expect(images.requests[0]!.referenceImageUrls).toEqual([
      'https://img.example.com/d.jpg',
      'https://img.example.com/c.jpg',
      'https://img.example.com/b.jpg',
    ]);
    expect(images.requests[0]!.prompt).toContain(REFERENCE_INSTRUCTION);
    expect(images.requests[0]!.width).toBe(1024);
    expect(images.requests[0]!.height).toBe(1024);
  });

  it('sends no anchors to a provider without reference-image support', async () => {
    const dir = await makeContentDir(['velleity'], {
      '2026-09-24.json': validEntry({ date: '2026-09-24' }),
    });
    const images = recordingImageProvider({ supportsReferenceImages: false });
    await fillBuffer(mockDeps(dir, path.join(dir, 'images'), { image: images.provider }), {
      today: '2026-09-25',
      bufferDays: 0,
      maxAttempts: 3,
    });
    expect(images.requests[0]!.referenceImageUrls).toEqual([]);
    expect(images.requests[0]!.prompt).not.toContain(REFERENCE_INSTRUCTION);
  });
});

describe('chooseStyleAnchors', () => {
  it('prefers the pinned list when one is configured', () => {
    const pinned = ['https://x.com/1.jpg', 'https://x.com/2.jpg', 'https://x.com/3.jpg', 'https://x.com/4.jpg'];
    expect(chooseStyleAnchors([validEntry()], pinned)).toEqual(pinned.slice(0, 3));
  });

  it('ignores drafts', () => {
    expect(chooseStyleAnchors([validEntry({ status: 'draft' })], [])).toEqual([]);
  });
});
