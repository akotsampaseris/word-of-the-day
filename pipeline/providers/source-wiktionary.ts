/**
 * Wiktionary source provider: fetches real etymology material so the model
 * rewrites facts instead of recalling them.
 *
 * Why the MediaWiki Action API and not the REST API: the REST
 * /page/definition endpoint returns definitions but no etymology. The Action
 * API's `action=parse` returns the rendered page HTML, which we walk with
 * cheerio to pull out the English etymology, IPA and definitions.
 *
 * When the English etymology is thin ("Alteration of kenspeck."), we follow
 * its first link one hop to the etymon's own entry and include that too.
 * Both URLs end up in etymologySources.
 *
 * Wikimedia rate-limits anonymous API clients aggressively, so requests are
 * spaced out, 429/5xx responses are retried with backoff, and every request
 * carries a descriptive User-Agent (set WIKTIONARY_USER_AGENT to include
 * your contact details, as Wikimedia's policy asks).
 */
import * as cheerio from 'cheerio';
import type { SourceMaterial, SourceProvider, SourceSection } from './types';

const API_URL = 'https://en.wiktionary.org/w/api.php';
const PAGE_URL = 'https://en.wiktionary.org/wiki/';

/**
 * Below this, an etymology is too thin to stand alone ("From Latin fūlīginōsus."),
 * so we follow one link. Longer ones usually link to words that are merely
 * mentioned ("rhymed with Italian"), which would only add noise.
 */
const THIN_ETYMOLOGY_CHARS = 120;
/** Below this, there is no usable etymology at all. */
const MIN_ETYMOLOGY_CHARS = 10;

const PARTS_OF_SPEECH = new Set([
  'Noun', 'Proper noun', 'Verb', 'Adjective', 'Adverb', 'Interjection', 'Preposition', 'Conjunction',
  'Pronoun', 'Numeral', 'Particle', 'Determiner', 'Article', 'Participle', 'Phrase', 'Prepositional phrase',
  'Idiom', 'Proverb', 'Contraction', 'Prefix', 'Suffix', 'Symbol',
]);

export interface WiktionaryOptions {
  userAgent: string;
  /** Minimum gap between requests. */
  minIntervalMs?: number;
  maxRetries?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function createWiktionarySourceProvider(options: WiktionaryOptions): SourceProvider {
  const client = createApiClient(options);

  return {
    name: 'wiktionary',
    async fetch(word: string): Promise<SourceMaterial | null> {
      const page = await client.fetchPage(word);
      if (!page) return null;

      const english = parseLanguageSection(page.html, 'English');
      if (!english || english.etymology.length < MIN_ETYMOLOGY_CHARS) return null;

      const sections = [toSourceSection(page.title, 'English', english)];

      const link = english.etymonLink;
      if (english.etymology.length < THIN_ETYMOLOGY_CHARS && link) {
        const linkedPage = link.title === null || link.title === page.title ? page : await client.fetchPage(link.title);
        const etymon = linkedPage && parseLanguageSection(linkedPage.html, link.language);
        // Only worth citing if it adds etymology (e.g. not a bare verb-form page).
        if (linkedPage && etymon && etymon.etymology.length >= MIN_ETYMOLOGY_CHARS) {
          sections.push(toSourceSection(linkedPage.title, link.language, etymon));
        }
      }

      return { word, urls: sections.map((section) => section.url), sections };
    },
  };
}

// ---------------------------------------------------------------------------
// HTML parsing (pure, tested against saved API responses in tests/fixtures)
// ---------------------------------------------------------------------------

export interface LanguageSection {
  etymology: string;
  pronunciations: string[];
  definitions: string[];
  /**
   * First Wiktionary link in the etymology, pointing at an etymon's entry.
   * `title` is null when the link points at another language on the same page.
   */
  etymonLink?: { title: string | null; language: string };
}

/**
 * Pulls one language's section (e.g. "English") out of a rendered Wiktionary
 * page. The HTML is flat: headings are <div class="mw-heading mw-headingN">
 * siblings of the content, so we walk the top-level children in order and
 * track which language and subsection we are in.
 */
export function parseLanguageSection(html: string, language: string): LanguageSection | null {
  const $ = cheerio.load(html);
  const root = $('.mw-parser-output').first();

  let currentLanguage: string | null = null;
  let currentHeading = '';
  // Pages with several unrelated origins number them ("Etymology 1", "Etymology 2");
  // we keep that label so the model can tell which origin goes with which sense.
  let numberedEtymology = '';
  let found = false;
  const etymologyParagraphs: string[] = [];
  const pronunciations: string[] = [];
  const definitions: string[] = [];
  let etymonLink: LanguageSection['etymonLink'];

  for (const element of root.children().toArray()) {
    const node = $(element);

    if (node.hasClass('mw-heading')) {
      const level = Number(/mw-heading(\d)/.exec(node.attr('class') ?? '')?.[1]);
      const text = cleanText(node.find('h1, h2, h3, h4, h5, h6').first().text());
      if (level === 2) {
        currentLanguage = text;
        numberedEtymology = '';
      }
      currentHeading = level === 2 ? '' : text;
      if (/^Etymology \d+$/.test(currentHeading)) numberedEtymology = currentHeading;
      if (currentLanguage === language) found = true;
      continue;
    }
    if (currentLanguage !== language) continue;

    if (currentHeading.startsWith('Etymology') && element.tagName === 'p') {
      etymonLink ??= findEtymonLink($, node, language);
      const text = paragraphText($, node);
      if (text) etymologyParagraphs.push(numberedEtymology ? `(${numberedEtymology}) ${text}` : text);
    } else if (currentHeading === 'Pronunciation') {
      node.find('.IPA').each((_, ipa) => {
        const text = cleanText($(ipa).text());
        // Keep full transcriptions (/.../ or [...]), not rhyme fragments like "-uː".
        if (/^[/[]/.test(text) && !pronunciations.includes(text)) pronunciations.push(text);
      });
    } else if (PARTS_OF_SPEECH.has(currentHeading) && element.tagName === 'ol') {
      node.children('li').each((_, item) => {
        const text = definitionText($, $(item));
        const label = [numberedEtymology, currentHeading.toLowerCase()].filter(Boolean).join(', ');
        if (text) definitions.push(`(${label}) ${text}`);
      });
    }
  }

  if (!found) return null;
  return {
    etymology: etymologyParagraphs.join(' '),
    pronunciations: pronunciations.slice(0, 3),
    definitions: definitions.slice(0, 6),
    etymonLink,
  };
}

/** Text of an etymology paragraph without footnote markers or maintenance notes. */
function paragraphText($: cheerio.CheerioAPI, paragraph: ReturnType<cheerio.CheerioAPI>): string {
  const copy = paragraph.clone();
  copy.find('sup.reference, style, .maintenance-line, .maintenance-box, .request-box').remove();
  return cleanText(copy.text());
}

/** Text of a definition, without the nested quotations and usage examples. */
function definitionText($: cheerio.CheerioAPI, item: ReturnType<cheerio.CheerioAPI>): string {
  const copy = item.clone();
  copy.find('ul, ol, dl, sup.reference, style, .h-usage-example, .citation-whole').remove();
  return cleanText(copy.text());
}

/**
 * The first link in the etymology that points at another dictionary entry:
 * "/wiki/kenspeck#English" (another page) or "#Latin" (same page, other
 * language). Links to pages that don't exist yet ("red links") and to
 * non-entry namespaces (Appendix:, w:) are skipped.
 *
 * Wiktionary marks the terms an etymology is actually built from with a
 * "mention" class, so those are tried first; a plain link ("rhymed with
 * Italian") is only a fallback.
 */
function findEtymonLink(
  $: cheerio.CheerioAPI,
  paragraph: ReturnType<cheerio.CheerioAPI>,
  currentLanguage: string,
): LanguageSection['etymonLink'] {
  const candidates = [...paragraph.find('.mention a').toArray(), ...paragraph.find('a').toArray()];
  for (const anchor of candidates) {
    const link = $(anchor);
    if (link.hasClass('new')) continue;
    const href = link.attr('href') ?? '';
    const otherPage = /^\/wiki\/([^:#]+)#(.+)$/.exec(href);
    if (otherPage) {
      return { title: decodeWikiName(otherPage[1]!), language: decodeWikiName(otherPage[2]!) };
    }
    const samePage = /^#(.+)$/.exec(href);
    if (samePage && decodeWikiName(samePage[1]!) !== currentLanguage) {
      return { title: null, language: decodeWikiName(samePage[1]!) };
    }
  }
  return undefined;
}

function toSourceSection(title: string, language: string, parsed: LanguageSection): SourceSection {
  return {
    url: pageUrl(title, language),
    language,
    title,
    etymology: parsed.etymology,
    pronunciations: parsed.pronunciations,
    definitions: parsed.definitions,
  };
}

export function pageUrl(title: string, language: string): string {
  return `${PAGE_URL}${encodeURIComponent(title.replaceAll(' ', '_'))}#${encodeURIComponent(language.replaceAll(' ', '_'))}`;
}

function decodeWikiName(value: string): string {
  return decodeURIComponent(value).replaceAll('_', ' ');
}

/** Collapses whitespace and drops invisible direction marks (U+200E/U+200F). */
function cleanText(text: string): string {
  return text.replace(/[‎‏]/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// HTTP: polite, throttled, retried
// ---------------------------------------------------------------------------

interface Page {
  title: string;
  html: string;
}

function createApiClient(options: WiktionaryOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const minIntervalMs = options.minIntervalMs ?? 1500;
  const maxRetries = options.maxRetries ?? 4;
  let lastRequestAt = 0;

  async function request(params: Record<string, string>): Promise<unknown> {
    const url = `${API_URL}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;

    for (let attempt = 0; ; attempt++) {
      const wait = lastRequestAt + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();

      const response = await fetchImpl(url, { headers: { 'User-Agent': options.userAgent, Accept: 'application/json' } });
      if (response.ok) return response.json();

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= maxRetries) {
        throw new Error(`Wiktionary API returned HTTP ${response.status} for ${params.page ?? 'request'}`);
      }
      // Honour Retry-After when given, otherwise back off exponentially: 5s, 10s, 20s...
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * 2 ** attempt);
    }
  }

  return {
    async fetchPage(title: string): Promise<Page | null> {
      const data = (await request({
        action: 'parse',
        page: title,
        prop: 'text',
        redirects: '1',
        disableeditsection: '1',
        disabletoc: '1',
      })) as { parse?: { title: string; text: string }; error?: { code: string; info?: string } };

      if (data.error) {
        if (data.error.code === 'missingtitle') return null;
        throw new Error(`Wiktionary API error for "${title}": ${data.error.code} ${data.error.info ?? ''}`.trim());
      }
      if (!data.parse) throw new Error(`Unexpected Wiktionary API response for "${title}"`);
      return { title: data.parse.title, html: data.parse.text };
    },
  };
}
