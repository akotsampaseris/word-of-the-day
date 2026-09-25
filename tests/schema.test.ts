import { describe, expect, it } from 'vitest';
import {
  EntrySchema,
  FailedDraftSchema,
  TextOutputSchema,
  formatZodIssues,
} from '../pipeline/schema';
import { validEntry, validTextOutput } from './helpers';

function issuesFor(value: unknown): string[] {
  const result = EntrySchema.safeParse(value);
  return result.success ? [] : formatZodIssues(result.error);
}

describe('EntrySchema', () => {
  it('accepts a valid entry', () => {
    expect(EntrySchema.safeParse(validEntry()).success).toBe(true);
  });

  it('accepts a site-relative image URL (used by mock images)', () => {
    const entry = validEntry();
    entry.image.url = '/mock-images/2026-09-25-gongoozler-abc.svg';
    expect(EntrySchema.safeParse(entry).success).toBe(true);
  });

  it('rejects a missing required field', () => {
    const { story: _story, ...withoutStory } = validEntry();
    expect(issuesFor(withoutStory)).toEqual([expect.stringMatching(/^story:/)]);
  });

  it('rejects unknown fields, including _errors', () => {
    const entry = { ...validEntry(), _errors: ['something failed'] };
    expect(EntrySchema.safeParse(entry).success).toBe(false);
  });

  it('limits the definition to 300 characters', () => {
    expect(issuesFor(validEntry({ definition: 'x'.repeat(300) }))).toEqual([]);
    expect(issuesFor(validEntry({ definition: 'x'.repeat(301) }))).toEqual([
      expect.stringMatching(/^definition:/),
    ]);
  });

  it('limits the etymology to 800 characters', () => {
    expect(issuesFor(validEntry({ etymology: 'x'.repeat(801) }))).toEqual([
      expect.stringMatching(/^etymology:/),
    ]);
  });

  it('requires at least one etymology source', () => {
    expect(issuesFor(validEntry({ etymologySources: [] }))).toEqual([
      expect.stringMatching(/^etymologySources:/),
    ]);
  });

  it('requires every etymology source to be an http(s) URL', () => {
    expect(issuesFor(validEntry({ etymologySources: ['not a url'] }))).toHaveLength(1);
    expect(issuesFor(validEntry({ etymologySources: ['ftp://example.com/x'] }))).toHaveLength(1);
  });

  it.each(['2026-02-30', '2026-9-5', '25/09/2026', '2026-13-01', ''])('rejects the date "%s"', (date) => {
    expect(issuesFor(validEntry({ date }))).toEqual([expect.stringMatching(/^date:/)]);
  });

  it('accepts a leap day', () => {
    expect(issuesFor(validEntry({ date: '2028-02-29' }))).toEqual([]);
  });

  it('only allows the draft and approved statuses', () => {
    // @ts-expect-error: deliberately invalid status
    expect(issuesFor(validEntry({ status: 'published' }))).toEqual([expect.stringMatching(/^status:/)]);
  });

  it.each(['Gongoozler', 'two words', 'trailing-', 'double--hyphen'])('rejects the slug "%s"', (slug) => {
    expect(issuesFor(validEntry({ slug }))).toEqual([expect.stringMatching(/^slug:/)]);
  });

  it('rejects an image URL that is neither absolute nor site-relative', () => {
    const entry = validEntry();
    entry.image.url = 'images/foo.png';
    expect(issuesFor(entry)).toEqual([expect.stringMatching(/^image\.url:/)]);
  });

  it('requires generatedAt to be an ISO timestamp', () => {
    expect(issuesFor(validEntry({ generatedAt: 'yesterday' }))).toEqual([
      expect.stringMatching(/^generatedAt:/),
    ]);
  });
});

describe('FailedDraftSchema', () => {
  const failed = {
    slug: 'gongoozler',
    word: 'gongoozler',
    date: '2026-09-25',
    status: 'draft',
    generatedAt: '2026-09-11T06:00:00.000Z',
    _errors: ['story: has 90 words; it must have between 120 and 200.'],
    definition: 'whatever the last attempt produced is kept',
  };

  it('accepts a partial entry with _errors and keeps the extra fields', () => {
    const result = FailedDraftSchema.safeParse(failed);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ definition: failed.definition });
  });

  it('is never approved', () => {
    expect(FailedDraftSchema.safeParse({ ...failed, status: 'approved' }).success).toBe(false);
  });

  it('requires at least one error', () => {
    expect(FailedDraftSchema.safeParse({ ...failed, _errors: [] }).success).toBe(false);
  });

  it('is not a valid Entry', () => {
    expect(EntrySchema.safeParse(failed).success).toBe(false);
  });
});

describe('TextOutputSchema', () => {
  it('accepts valid model output', () => {
    expect(TextOutputSchema.safeParse(validTextOutput()).success).toBe(true);
  });

  it('rejects a multi-line image prompt', () => {
    const result = TextOutputSchema.safeParse(validTextOutput({ imagePrompt: 'one\ntwo' }));
    expect(result.success).toBe(false);
  });

  it('rejects fields the model is not supposed to supply', () => {
    const result = TextOutputSchema.safeParse({ ...validTextOutput(), etymologySources: ['https://x.com'] });
    expect(result.success).toBe(false);
  });
});
