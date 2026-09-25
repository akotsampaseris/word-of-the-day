/**
 * Generation: fills every missing date from today to today + bufferDays.
 *
 * Per word:
 *   1. Take the next unused word from content/words.json.
 *   2. Fetch source material (Wiktionary). No usable etymology → skip the word.
 *   3. One text call → JSON → validate. On failure, send the errors back as a
 *      repair instruction and try again, up to maxAttempts in total.
 *      Still failing → write a FailedDraft with `_errors` and move on.
 *   4. Generate the image, store it, record its public URL.
 *   5. Write content/<date>.json with status "draft".
 *
 * Two kinds of failure are handled differently on purpose:
 *   - Bad model output is expected; it is retried, then recorded as a failed
 *     draft so the run continues with the next date.
 *   - A provider throwing (network error, outage, bad key) stops the run.
 *     Carrying on would only produce a pile of identical failures.
 *     Files already written are kept.
 */
import { createContentFile, entriesOf, loadContent, readWordQueue, unusedWords, usedSlugs } from './content-store';
import { addDays, dateRange } from './dates';
import { parseModelJson } from './parse-json';
import { SYSTEM_PROMPT, buildRepairPrompt, buildTextPrompt } from './prompts';
import type {
  ChatMessage,
  ImageProvider,
  ImageStore,
  SourceMaterial,
  SourceProvider,
  TextProvider,
} from './providers/types';
import { checkContentRules, dateIsFree } from './rules';
import {
  EntrySchema,
  TextOutputSchema,
  formatZodIssues,
  type Entry,
  type FailedDraft,
  type TextOutput,
} from './schema';
import { seedFor, shortHash } from './seed';
import { slugify } from './slug';
import { IMAGE_HEIGHT, IMAGE_WIDTH, buildImagePrompt } from './style';

export const STYLE_ANCHOR_COUNT = 3;

export interface PipelineDeps {
  text: TextProvider;
  image: ImageProvider;
  source: SourceProvider;
  store: ImageStore;
  contentDir: string;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface FillOptions {
  today: string;
  bufferDays: number;
  maxAttempts: number;
  /** Pinned style anchors (STYLE_ANCHOR_URLS). Empty = use recent approved images. */
  styleAnchorUrls?: string[];
}

export interface RunSummary {
  created: { date: string; word: string }[];
  failed: { date: string; word: string; errors: string[] }[];
  skipped: { word: string; reason: string }[];
  /** Dates left empty because the word queue ran out or the run stopped. */
  unfilled: string[];
  /** Set when a provider threw and the run stopped early. */
  aborted?: { date: string; word: string; error: string };
}

export async function fillBuffer(deps: PipelineDeps, options: FillOptions): Promise<RunSummary> {
  const log = deps.log ?? (() => {});
  const summary: RunSummary = { created: [], failed: [], skipped: [], unfilled: [] };

  const files = await loadContent(deps.contentDir);
  const existingDates = new Set(files.map((file) => file.date));
  const queue = unusedWords(await readWordQueue(deps.contentDir), usedSlugs(files));
  const anchors = chooseStyleAnchors(entriesOf(files), options.styleAnchorUrls ?? []);

  const window = dateRange(options.today, addDays(options.today, options.bufferDays));
  const missingDates = window.filter((date) => dateIsFree(date, existingDates) === null);
  if (missingDates.length === 0) log('Buffer is already full.');

  for (const [index, date] of missingDates.entries()) {
    let filled = false;

    while (!filled && queue.length > 0) {
      const word = queue.shift()!;
      log(`${date}: generating "${word}"`);

      let result: EntryResult;
      try {
        result = await generateEntry({ word, date, deps, maxAttempts: options.maxAttempts, anchors });
      } catch (error) {
        summary.aborted = { date, word, error: error instanceof Error ? error.message : String(error) };
        summary.unfilled.push(...missingDates.slice(index));
        return summary;
      }

      if (result.kind === 'skipped') {
        log(`  skipped "${word}": ${result.reason}`);
        summary.skipped.push({ word, reason: result.reason });
        continue; // same date, next word
      }

      if (result.kind === 'created') {
        await createContentFile(deps.contentDir, result.entry);
        summary.created.push({ date, word });
        log(`  wrote content/${date}.json (draft)`);
      } else {
        await createContentFile(deps.contentDir, result.draft);
        summary.failed.push({ date, word, errors: result.draft._errors });
        log(`  gave up after ${options.maxAttempts} attempts; wrote content/${date}.json with _errors`);
      }
      existingDates.add(date);
      filled = true;
    }

    if (!filled) summary.unfilled.push(date);
  }

  return summary;
}

// ---------------------------------------------------------------------------
// One entry
// ---------------------------------------------------------------------------

export type EntryResult =
  | { kind: 'created'; entry: Entry }
  | { kind: 'failed'; draft: FailedDraft }
  | { kind: 'skipped'; reason: string };

export async function generateEntry(args: {
  word: string;
  date: string;
  deps: PipelineDeps;
  maxAttempts: number;
  anchors: string[];
}): Promise<EntryResult> {
  const { word, date, deps } = args;
  const slug = slugify(word);
  const seed = seedFor(date, slug);
  const now = deps.now ?? (() => new Date());

  const source = await deps.source.fetch(word);
  if (!source) {
    return { kind: 'skipped', reason: `no usable etymology from the "${deps.source.name}" source` };
  }

  const text = await generateTextWithRepair({
    provider: deps.text,
    word,
    source,
    seed,
    maxAttempts: args.maxAttempts,
    log: deps.log,
  });

  if (!text.ok) {
    // Skip the image: there is no point paying for a picture of a failed entry.
    return {
      kind: 'failed',
      draft: {
        slug,
        word,
        date,
        status: 'draft',
        _errors: text.errors,
        ...pickTextFields(text.lastValue),
        etymologySources: source.urls,
        generatedAt: now().toISOString(),
        ...(text.lastValue === undefined ? { _lastResponse: text.lastResponse } : {}),
      },
    };
  }

  const withReferences = deps.image.supportsReferenceImages && args.anchors.length > 0;
  const prompt = buildImagePrompt(text.value.imagePrompt, { withReferences });
  const image = await deps.image.generate({
    prompt,
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    referenceImageUrls: withReferences ? args.anchors : [],
    seed,
    word,
  });
  // The content hash makes every image URL unique, so a regenerated image
  // never hides behind a cached old one.
  const key = `${date}-${slug}-${shortHash(image.bytes)}.${image.extension}`;
  const url = await deps.store.put(key, image);

  const entry: Entry = {
    slug,
    word,
    date,
    status: 'draft',
    pronunciation: text.value.pronunciation,
    partOfSpeech: text.value.partOfSpeech,
    definition: text.value.definition,
    etymology: text.value.etymology,
    etymologySources: source.urls,
    story: text.value.story,
    image: { url, prompt, provider: deps.image.name, model: deps.image.model, alt: text.value.imageAlt },
    generatedAt: now().toISOString(),
  };

  // Final check of the assembled entry, before anything is written.
  const checked = EntrySchema.safeParse(entry);
  if (!checked.success) {
    return { kind: 'failed', draft: { ...entry, status: 'draft', _errors: formatZodIssues(checked.error) } };
  }
  return { kind: 'created', entry: checked.data };
}

// ---------------------------------------------------------------------------
// The retry / repair loop
// ---------------------------------------------------------------------------

export type TextResult =
  | { ok: true; value: TextOutput; attempts: number }
  | { ok: false; errors: string[]; attempts: number; lastValue: unknown; lastResponse: string };

/**
 * Asks the model for the entry text, validates it, and on failure feeds the
 * specific errors back as a repair instruction. The conversation grows by two
 * messages per failed attempt: the model's reply, then the list of problems.
 */
export async function generateTextWithRepair(args: {
  provider: TextProvider;
  word: string;
  source: SourceMaterial;
  seed: number;
  maxAttempts: number;
  log?: (message: string) => void;
}): Promise<TextResult> {
  const { provider, word, source, seed, maxAttempts } = args;
  const messages: ChatMessage[] = [{ role: 'user', content: buildTextPrompt(word, source) }];

  let errors: string[] = [];
  let lastValue: unknown;
  let lastResponse = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResponse = await provider.complete({ system: SYSTEM_PROMPT, messages: [...messages], seed, word });

    const parsed = parseModelJson(lastResponse);
    if (parsed.ok) {
      lastValue = parsed.value;
      const checked = validateTextOutput(parsed.value, word, source.urls);
      if (checked.ok) return { ok: true, value: checked.value, attempts: attempt };
      errors = checked.errors;
    } else {
      lastValue = undefined;
      errors = [parsed.error];
    }

    args.log?.(`  attempt ${attempt}/${maxAttempts} failed: ${errors.join(' | ')}`);
    messages.push(
      { role: 'assistant', content: lastResponse || '(empty reply)' },
      { role: 'user', content: buildRepairPrompt(errors) },
    );
  }

  return { ok: false, errors, attempts: maxAttempts, lastValue, lastResponse };
}

/** Schema check plus content rules, collected together so one repair can fix everything. */
export function validateTextOutput(
  value: unknown,
  word: string,
  sourceUrls: string[],
): { ok: true; value: TextOutput } | { ok: false; errors: string[] } {
  const schema = TextOutputSchema.safeParse(value);
  const fields = isRecord(value) ? value : {};
  const errors = [
    ...(schema.success ? [] : formatZodIssues(schema.error)),
    ...checkContentRules({
      word,
      definition: fields.definition,
      etymology: fields.etymology,
      story: fields.story,
      etymologySources: sourceUrls,
    }),
  ];
  if (schema.success && errors.length === 0) return { ok: true, value: schema.data };
  return { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The style anchors for image generation: the pinned list if one is set,
 * otherwise the images of the 3 most recent approved entries. Mock images and
 * site-relative URLs are never used (a real provider could not fetch them).
 */
export function chooseStyleAnchors(entries: Entry[], pinned: string[]): string[] {
  if (pinned.length > 0) return pinned.slice(0, STYLE_ANCHOR_COUNT);
  return entries
    .filter((entry) => entry.status === 'approved')
    .filter((entry) => entry.image.provider !== 'mock' && /^https?:\/\//.test(entry.image.url))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, STYLE_ANCHOR_COUNT)
    .map((entry) => entry.image.url);
}

/** Markdown summary of a run, printed to the console and used as the CI pull request body. */
export function formatRunSummary(
  summary: RunSummary,
  context: { today: string; bufferDays: number; providers: string[] },
): string {
  const lines = [
    `## Generation run for ${context.today} (buffer: ${context.bufferDays} days ahead)`,
    '',
    ...context.providers.map((line) => `- ${line}`),
    '',
  ];

  if (summary.created.length > 0) {
    lines.push(`### New drafts (${summary.created.length})`, '');
    for (const { date, word } of summary.created) lines.push(`- ${date}: **${word}**`);
    lines.push('');
  }
  if (summary.failed.length > 0) {
    lines.push(`### Failed drafts needing a human (${summary.failed.length})`, '');
    for (const { date, word, errors } of summary.failed) {
      lines.push(`- ${date}: **${word}**`, ...errors.map((error) => `  - ${error}`));
    }
    lines.push('');
  }
  if (summary.skipped.length > 0) {
    lines.push(`### Skipped words (${summary.skipped.length})`, '');
    for (const { word, reason } of summary.skipped) lines.push(`- ${word}: ${reason}. Consider removing it from words.json.`);
    lines.push('');
  }
  if (summary.unfilled.length > 0) {
    lines.push(`### Dates still empty (${summary.unfilled.length})`, '', `- ${summary.unfilled.join(', ')}`, '');
  }
  if (summary.aborted) {
    const { date, word, error } = summary.aborted;
    lines.push('### Run stopped early', '', `A provider failed while generating ${date} ("${word}"): ${error}`, '');
  }
  if (
    summary.created.length + summary.failed.length + summary.skipped.length + summary.unfilled.length === 0 &&
    !summary.aborted
  ) {
    lines.push('Nothing to do: the buffer is full.', '');
  }

  lines.push('To publish a draft: review it, run `pnpm pipeline:approve <date>`, and commit.');
  return lines.join('\n');
}

const TEXT_FIELDS = [
  'pronunciation',
  'partOfSpeech',
  'definition',
  'etymology',
  'story',
  'imagePrompt',
  'imageAlt',
] as const;

/** Keeps only the known text fields from a (possibly malformed) model reply. */
function pickTextFields(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(TEXT_FIELDS.filter((key) => key in value).map((key) => [key, value[key]]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
