/**
 * The Wiktionary provider, tested offline against real API responses saved
 * in tests/fixtures/wiktionary (fetched September 2026).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWiktionarySourceProvider, pageUrl, parseLanguageSection } from '../pipeline/providers/source-wiktionary';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'wiktionary');

function fixtureJson(page: string): string | undefined {
  try {
    return readFileSync(path.join(FIXTURES, `${page}.json`), 'utf8');
  } catch {
    return undefined;
  }
}

function fixtureHtml(page: string): string {
  return JSON.parse(fixtureJson(page)!).parse.text;
}

/** A fake fetch that serves fixtures by page name and records every request. */
function fakeFetch(options: { failFirst?: number; status?: number; missing?: string[] } = {}) {
  const requests: { url: URL; userAgent: string | null }[] = [];
  let failuresLeft = options.failFirst ?? 0;

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url, userAgent: new Headers(init?.headers).get('User-Agent') });
    if (failuresLeft > 0) {
      failuresLeft--;
      return new Response('You are making too many requests.', {
        status: options.status ?? 429,
        headers: { 'Retry-After': '2' },
      });
    }
    const page = url.searchParams.get('page')!;
    const body =
      (options.missing?.includes(page) ? undefined : fixtureJson(page)) ??
      JSON.stringify({ error: { code: 'missingtitle' } });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  return { fetchImpl, requests };
}

function provider(fetchImpl: typeof fetch, sleeps: number[] = []) {
  return createWiktionarySourceProvider({
    userAgent: 'test-agent/1.0 (tests)',
    fetchImpl,
    minIntervalMs: 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
}

describe('parseLanguageSection', () => {
  it('extracts etymology, IPA and definitions, and finds the etymon link', () => {
    const section = parseLanguageSection(fixtureHtml('kenspeckle'), 'English');
    expect(section).toEqual({
      etymology: 'Alteration of kenspeck.',
      pronunciations: ['/ˈkɛnspɛkəl/'],
      definitions: ['(adjective) (Scotland, northern UK) Easily recognized, distinctive, conspicuous.'],
      etymonLink: { title: 'kenspeck', language: 'English' },
    });
  });

  it('ignores the etymology-tree widget and its stylesheet', () => {
    const section = parseLanguageSection(fixtureHtml('obambulate'), 'English')!;
    expect(section.etymology).toMatch(/^First attested in 1614; borrowed from Latin obambulātus/);
    expect(section.etymology).not.toMatch(/Etymology tree|Proto-Indo-European|\.mw-parser-output/);
  });

  it('drops footnote markers', () => {
    const section = parseLanguageSection(fixtureHtml('gardyloo'), 'English')!;
    expect(section.etymology).toBe(
      'From French (prenez) garde à l\'eau (“take heed of the water”). First attested in 1662, in the burgh records of Edinburgh.',
    );
  });

  it('keeps definitions but drops quotations and usage examples', () => {
    const section = parseLanguageSection(fixtureHtml('gardyloo'), 'English')!;
    expect(section.definitions[0]).toBe(
      '(interjection) (Scotland, historical) A cry used to warn passersby that a vessel of wastewater is about to be emptied into the street.',
    );
    for (const definition of section.definitions) expect(definition).not.toMatch(/\d{4},/); // no citation years
  });

  it('labels numbered etymologies so senses and origins stay paired', () => {
    const section = parseLanguageSection(fixtureHtml('spurtle'), 'English')!;
    expect(section.etymology).toMatch(/^\(Etymology 1\) From Scots spurtle/);
    expect(section.etymology).toContain('(Etymology 2) From spurt + -le.');
    expect(section.definitions).toEqual([
      expect.stringMatching(/^\(Etymology 1, noun\) Either of two Scottish kitchen implements/),
      expect.stringMatching(/^\(Etymology 2, verb\) To spurt/),
    ]);
    expect(section.etymonLink).toEqual({ title: null, language: 'Scots' }); // same-page link
  });

  it('returns null when the language has no section', () => {
    expect(parseLanguageSection(fixtureHtml('kenspeckle'), 'Klingon')).toBeNull();
  });

  it('builds page URLs with the language anchor', () => {
    expect(pageUrl('will-o\'-the-wisp', 'Middle English')).toBe(
      "https://en.wiktionary.org/wiki/will-o'-the-wisp#Middle_English",
    );
  });
});

describe('Wiktionary source provider', () => {
  it('follows one link when the etymology is thin, and records both URLs', async () => {
    const { fetchImpl, requests } = fakeFetch();
    const material = await provider(fetchImpl).fetch('kenspeckle');

    expect(material?.urls).toEqual([
      'https://en.wiktionary.org/wiki/kenspeckle#English',
      'https://en.wiktionary.org/wiki/kenspeck#English',
    ]);
    expect(material?.sections[1]?.etymology).toMatch(/^Apparently from Old Norse kennispakr/);
    expect(requests.map((r) => r.url.searchParams.get('page'))).toEqual(['kenspeckle', 'kenspeck']);
    expect(requests[0]!.userAgent).toBe('test-agent/1.0 (tests)');
    expect(requests[0]!.url.searchParams.get('action')).toBe('parse');
  });

  it.each(['spurtle', 'obambulate'])('does not follow links when the etymology of "%s" is substantial', async (word) => {
    const { fetchImpl, requests } = fakeFetch();
    const material = await provider(fetchImpl).fetch(word);
    expect(material?.urls).toEqual([`https://en.wiktionary.org/wiki/${word}#English`]);
    expect(requests).toHaveLength(1);
  });

  it('keeps the English section when the linked page does not exist', async () => {
    const { fetchImpl, requests } = fakeFetch({ missing: ['kenspeck'] });
    const material = await provider(fetchImpl).fetch('kenspeckle');
    expect(material?.urls).toEqual(['https://en.wiktionary.org/wiki/kenspeckle#English']);
    expect(requests).toHaveLength(2);
  });

  it('returns null for a page that does not exist', async () => {
    const { fetchImpl } = fakeFetch();
    expect(await provider(fetchImpl).fetch('notarealwordatall')).toBeNull();
  });

  it('waits and retries when rate-limited, honouring Retry-After', async () => {
    const { fetchImpl, requests } = fakeFetch({ failFirst: 2 });
    const sleeps: number[] = [];
    const material = await provider(fetchImpl, sleeps).fetch('spurtle');
    expect(material).not.toBeNull();
    expect(requests).toHaveLength(3);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it('throws on errors that retrying will not fix', async () => {
    const { fetchImpl } = fakeFetch({ failFirst: 1, status: 403 });
    await expect(provider(fetchImpl).fetch('spurtle')).rejects.toThrow(/HTTP 403/);
  });
});
