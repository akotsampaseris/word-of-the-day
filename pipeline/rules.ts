/**
 * Deterministic content rules. These run on every generated entry (and again
 * in `pipeline:validate`). They are cheap, they never call a model, and their
 * messages are written so they can be pasted straight into a repair prompt.
 *
 * Each rule returns an error message, or null when the content passes.
 */

export const STORY_MIN_WORDS = 120;
export const STORY_MAX_WORDS = 200;
export const DEFINITION_SENTENCES = { min: 1, max: 2 };
export const ETYMOLOGY_SENTENCES = { min: 2, max: 4 };

/** House style bans em-dashes. A double hyphen is the plain-text spelling of one. */
const EM_DASH_PATTERN = /—|--/g;

/**
 * The subset of an entry the content rules look at. Text fields are `unknown`
 * because this also runs on raw model output: a field that is missing or not a
 * string is skipped here (the schema check reports it instead).
 */
export interface RuleInput {
  word: string;
  definition?: unknown;
  etymology?: unknown;
  story?: unknown;
  etymologySources: unknown[];
}

/** Runs every content rule and returns all failures (empty array = pass). */
export function checkContentRules(input: RuleInput): string[] {
  const { word, definition, etymology, story } = input;
  const results: (string | null)[] = [];

  if (typeof story === 'string') {
    results.push(storyContainsWord(story, word), storyHasNoEmDashes(story), storyWordCountInRange(story));
  }
  if (typeof definition === 'string') {
    results.push(definitionDoesNotRestateWord(definition, word), definitionSentenceCountInRange(definition));
  }
  if (typeof etymology === 'string') {
    results.push(etymologySentenceCountInRange(etymology));
  }
  results.push(etymologySourcesAreValid(input.etymologySources));

  return results.filter((result): result is string => result !== null);
}

export function storyContainsWord(story: string, word: string): string | null {
  if (wordFormPattern(word).test(story)) return null;
  return `story: must use the word "${word}" at least once (an inflected form such as a plural or past tense is fine).`;
}

export function definitionDoesNotRestateWord(definition: string, word: string): string | null {
  // Ignore leading quotes and a leading article or "to", so that
  // "A gongoozler is..." and "To absquatulate means..." are both caught.
  const opening = definition
    .trim()
    .replace(/^["'“‘(]+/, '')
    .replace(/^(?:a|an|the|to)\s+/i, '');
  const startsWithWord = new RegExp(`^${wordFormAlternation(word)}(?!\\p{L})`, 'iu');
  if (!startsWithWord.test(opening)) return null;
  return `definition: must not begin by restating the word "${word}". Start directly with the meaning.`;
}

export function etymologySourcesAreValid(sources: unknown[]): string | null {
  if (sources.length === 0) {
    return 'etymologySources: must list at least one source URL.';
  }
  const bad = sources.filter((source) => typeof source !== 'string' || !isHttpUrl(source));
  if (bad.length === 0) return null;
  return `etymologySources: every entry must be a well-formed http(s) URL; invalid: ${bad
    .map((value) => JSON.stringify(value))
    .join(', ')}.`;
}

export function storyHasNoEmDashes(story: string): string | null {
  const count = story.match(EM_DASH_PATTERN)?.length ?? 0;
  if (count === 0) return null;
  return `story: contains ${count} em-dash${count === 1 ? '' : 'es'} (— or --). House style forbids them; use commas, colons, parentheses or separate sentences instead.`;
}

export function storyWordCountInRange(story: string): string | null {
  const count = countWords(story);
  if (count >= STORY_MIN_WORDS && count <= STORY_MAX_WORDS) return null;
  return `story: has ${count} words; it must have between ${STORY_MIN_WORDS} and ${STORY_MAX_WORDS}.`;
}

export function definitionSentenceCountInRange(definition: string): string | null {
  return sentenceCountRule('definition', definition, DEFINITION_SENTENCES);
}

export function etymologySentenceCountInRange(etymology: string): string | null {
  return sentenceCountRule('etymology', etymology, ETYMOLOGY_SENTENCES);
}

/** Returns an error if `date` is already taken by an existing content file. */
export function dateIsFree(date: string, existingDates: ReadonlySet<string>): string | null {
  if (!existingDates.has(date)) return null;
  return `date: ${date} already has an entry (content/${date}.json).`;
}

// ---------------------------------------------------------------------------
// Helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Counts whitespace-separated tokens that contain at least one letter or digit. */
export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/**
 * Counts sentences with a simple heuristic: a sentence ends at . ! or ?
 * (plus any closing quotes or brackets) when followed by an uppercase letter
 * or by the end of the text. "c. 1400" is therefore not a sentence break.
 * Text without final punctuation still counts as one sentence.
 */
export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  const endings = trimmed.match(/[.!?]+["'”’)\]]*(?=\s+["'“‘(]?\p{Lu}|\s*$)/gu) ?? [];
  return Math.max(1, endings.length);
}

/**
 * The spellings of `word` we accept as "containing the word": the word itself
 * plus common English inflections (and a few Latin/Greek plurals).
 * Deliberately generous: a false failure costs a retry, a false pass costs nothing.
 */
export function wordForms(word: string): string[] {
  const base = word.toLowerCase();
  const forms = new Set<string>([base]);
  const add = (stem: string, suffixes: string[]) => suffixes.forEach((suffix) => forms.add(stem + suffix));

  add(base, ['s', 'es', 'd', 'ed', 'ing', 'er', 'ers', 'est', 'ly']);

  if (base.endsWith('e')) add(base.slice(0, -1), ['ing', 'ed', 'er', 'ers', 'est', 'y']); // absquatulate → absquatulating
  if (base.endsWith('y')) add(base.slice(0, -1), ['ies', 'ied', 'ier', 'iest', 'ily']); // mollify → mollified
  if (base.endsWith('le')) add(base.slice(0, -1), ['y']); // gentle → gently
  if (base.endsWith('ic')) add(base, ['al', 'ally']); // ptarmic → ptarmically
  if (/[aeiou][bdgklmnprtz]$/.test(base)) add(base + base.at(-1), ['ed', 'ing', 'er', 'ers']); // brag → bragged

  if (base.endsWith('us')) add(base.slice(0, -2), ['i']); // famulus → famuli
  if (base.endsWith('um')) add(base.slice(0, -2), ['a']);
  if (base.endsWith('is')) add(base.slice(0, -2), ['es']);
  if (base.endsWith('on')) add(base.slice(0, -2), ['a']);

  return [...forms];
}

/** Matches any form of `word` as a whole word, case-insensitively. */
export function wordFormPattern(word: string): RegExp {
  return new RegExp(`(?<!\\p{L})${wordFormAlternation(word)}(?!\\p{L})`, 'iu');
}

function wordFormAlternation(word: string): string {
  // Longest first, so the regex prefers "gongoozlers" over "gongoozler".
  const forms = wordForms(word).sort((a, b) => b.length - a.length);
  return `(?:${forms.map(escapeRegExp).join('|')})`;
}

function sentenceCountRule(
  field: string,
  text: string,
  range: { min: number; max: number },
): string | null {
  const count = countSentences(text);
  if (count >= range.min && count <= range.max) return null;
  const expected = range.min === range.max ? `${range.min}` : `${range.min} to ${range.max}`;
  return `${field}: has ${count} sentence${count === 1 ? '' : 's'}; it must have ${expected}.`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}
