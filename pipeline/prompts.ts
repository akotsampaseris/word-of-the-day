/**
 * The prompts sent to the text model. There is one generation prompt and one
 * repair prompt; both ask for bare JSON matching TextOutputSchema.
 *
 * The key idea: the etymology must come from the fetched source material,
 * never from the model's memory. Models produce confident, plausible and
 * wrong derivations, so the prompt allows explaining the sources but not
 * adding to them.
 */
import type { SourceMaterial } from './providers/types';
import { DEFINITION_SENTENCES, ETYMOLOGY_SENTENCES, STORY_MAX_WORDS, STORY_MIN_WORDS } from './rules';

export const SYSTEM_PROMPT =
  'You write entries for a word-of-the-day website read by curious general readers. ' +
  'You reply with a single JSON object and nothing else: no markdown, no code fences, no commentary.';

export function buildTextPrompt(word: string, source: SourceMaterial): string {
  return `Write the entry for the word "${word}".

SOURCE MATERIAL
This was fetched from Wiktionary for this entry. It is the only acceptable basis for the etymology.

${formatSourceMaterial(source)}

FIELDS
- pronunciation: IPA between slashes. Copy it from the source material when one is given; if several are given, use the first.
- partOfSpeech: lowercase, e.g. "noun", "verb", "adjective", for the sense you define.
- definition: ${DEFINITION_SENTENCES.min} or ${DEFINITION_SENTENCES.max} sentences, at most 300 characters, in plain modern English, based on the source definitions. Do not begin with the word itself (not "${word}: ..." and not "A ${word} is ..."). Begin directly with the meaning.
- etymology: ${ETYMOLOGY_SENTENCES.min} to ${ETYMOLOGY_SENTENCES.max} sentences, at most 800 characters. Use only facts stated in the source material. You may explain those facts for a general reader, for example by saying what a source language was or how the original meaning led to the modern one. Never add a language, date, root, person or claim that the source material does not contain. If the source says the origin is uncertain or unknown, say so plainly.
- story: an original piece of very short fiction, ${STORY_MIN_WORDS} to ${STORY_MAX_WORDS} words, that uses "${word}" naturally at least once. Plain prose with no title. Do not use em-dashes or double hyphens; use commas, colons, parentheses or separate sentences instead.
- imagePrompt: a single clause of at most 40 words describing one concrete scene that evokes the meaning. Describe only the subject: no art style, medium or colours (those are fixed separately), and no text, letters or words in the scene.
- imageAlt: one sentence describing that scene for someone who cannot see it.

OUTPUT
Reply with exactly this JSON shape and nothing else:
{"pronunciation": "...", "partOfSpeech": "...", "definition": "...", "etymology": "...", "story": "...", "imagePrompt": "...", "imageAlt": "..."}`;
}

/** Sent after a failed attempt, together with the model's previous reply. */
export function buildRepairPrompt(errors: string[]): string {
  return `Your previous reply could not be used. Problems found:
${errors.map((error) => `- ${error}`).join('\n')}

Reply again with the complete, corrected JSON object (all seven fields) and nothing else.`;
}

export function formatSourceMaterial(source: SourceMaterial): string {
  return source.sections
    .map((section, index) => {
      const lines = [`[Source ${index + 1}] ${section.url}`, `${section.language} entry for "${section.title}"`];
      lines.push(`Etymology: ${section.etymology || '(none given)'}`);
      if (section.pronunciations.length > 0) lines.push(`Pronunciation (IPA): ${section.pronunciations.join(', ')}`);
      if (section.definitions.length > 0) {
        lines.push('Definitions:', ...section.definitions.map((definition) => `  - ${definition}`));
      }
      return lines.join('\n');
    })
    .join('\n\n');
}
