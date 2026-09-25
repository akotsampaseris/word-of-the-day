import { describe, expect, it } from 'vitest';
import {
  checkContentRules,
  countSentences,
  countWords,
  dateIsFree,
  definitionDoesNotRestateWord,
  definitionSentenceCountInRange,
  etymologySentenceCountInRange,
  etymologySourcesAreValid,
  storyContainsWord,
  storyHasNoEmDashes,
  storyWordCountInRange,
} from '../pipeline/rules';
import { VALID_STORY, validEntry } from './helpers';

function words(count: number, filler = 'lorem'): string {
  return Array.from({ length: count }, () => filler).join(' ');
}

describe('checkContentRules', () => {
  it('passes a valid entry', () => {
    expect(checkContentRules(validEntry())).toEqual([]);
  });

  it('reports every failure at once, so one repair prompt can fix them all', () => {
    const errors = checkContentRules(
      validEntry({ definition: 'Gongoozler: a canal watcher.', story: 'Too short — and no word.' }),
    );
    // Missing word, em-dash, too short; then the definition restating the word.
    expect(errors.map((error) => error.split(':')[0])).toEqual(['story', 'story', 'story', 'definition']);
  });

  it('skips rules for fields that are missing or not strings', () => {
    expect(checkContentRules({ word: 'ort', story: 42, etymologySources: ['https://x.org/ort'] })).toEqual([]);
  });
});

describe('storyContainsWord', () => {
  it.each([
    ['exact', 'gongoozler', 'She was a gongoozler.'],
    ['case-insensitive', 'gongoozler', 'GONGOOZLER, she said.'],
    ['plural', 'gongoozler', 'The gongoozlers gathered.'],
    ['possessive', 'gongoozler', "The gongoozler's flask was empty."],
    ['curly possessive', 'gongoozler', 'The gongoozler’s flask was empty.'],
    ['-ing with dropped e', 'absquatulate', 'He was absquatulating again.'],
    ['-ed', 'absquatulate', 'He absquatulated at dawn.'],
    ['-s on a verb', 'obambulate', 'She obambulates nightly.'],
    ['y to ied', 'mollify', 'He was mollified.'],
    ['Latin plural', 'famulus', 'The famuli bowed.'],
    ['-ic to -ically', 'ptarmic', 'She sneezed ptarmically.'],
    ['doubled consonant', 'brag', 'He bragged about it.'],
    ['hyphenated word', 'will-o-the-wisp', 'A will-o-the-wisp flickered.'],
  ])('accepts %s', (_label, word, story) => {
    expect(storyContainsWord(story, word)).toBeNull();
  });

  it('fails when the word is missing', () => {
    expect(storyContainsWord('Nobody watched the boats.', 'gongoozler')).toMatch(/must use the word "gongoozler"/);
  });

  it('does not match the word inside a longer, different word', () => {
    expect(storyContainsWord('The ortolan sang.', 'ort')).not.toBeNull();
  });
});

describe('definitionDoesNotRestateWord', () => {
  it('passes when the definition starts with the meaning', () => {
    expect(definitionDoesNotRestateWord('A person who idly watches canal boats.', 'gongoozler')).toBeNull();
  });

  it('passes when the word appears later in the definition', () => {
    expect(definitionDoesNotRestateWord('An idle onlooker; the classic gongoozler watches boats.', 'gongoozler')).toBeNull();
  });

  it.each([
    'Gongoozler: a person who watches canal boats.',
    'gongoozler - someone who watches boats.',
    'A gongoozler is a person who watches boats.',
    'The gongoozler watches boats.',
    '"Gongoozler" means an idle onlooker.',
    'Gongoozlers are idle onlookers.',
  ])('fails for "%s"', (definition) => {
    expect(definitionDoesNotRestateWord(definition, 'gongoozler')).toMatch(/must not begin by restating/);
  });

  it('catches "To <verb> means..." for verbs', () => {
    expect(definitionDoesNotRestateWord('To absquatulate means to leave abruptly.', 'absquatulate')).not.toBeNull();
  });
});

describe('etymologySourcesAreValid', () => {
  it('passes for well-formed URLs', () => {
    expect(etymologySourcesAreValid(['https://en.wiktionary.org/wiki/gongoozler#English'])).toBeNull();
  });

  it('fails when empty', () => {
    expect(etymologySourcesAreValid([])).toMatch(/at least one/);
  });

  it.each([['not a url'], ['wiktionary.org/wiki/x'], ['mailto:someone@example.com'], [42]])(
    'fails for %j',
    (source) => {
      expect(etymologySourcesAreValid(['https://en.wiktionary.org/wiki/x', source])).toMatch(/well-formed/);
    },
  );
});

describe('storyHasNoEmDashes', () => {
  it('passes without em-dashes (hyphens and en-dashes are fine)', () => {
    expect(storyHasNoEmDashes('A well-known story, pages 3–5.')).toBeNull();
  });

  it('fails on an em-dash', () => {
    expect(storyHasNoEmDashes('She paused — then left.')).toMatch(/contains 1 em-dash /);
  });

  it('fails on a double hyphen and counts them', () => {
    expect(storyHasNoEmDashes('She paused -- then left -- quickly.')).toMatch(/contains 2 em-dashes/);
  });
});

describe('storyWordCountInRange', () => {
  it('counts the words in the fixture story', () => {
    expect(countWords(VALID_STORY)).toBe(167); // matches `wc -w`
  });

  it('accepts the boundaries 120 and 200', () => {
    expect(storyWordCountInRange(words(120))).toBeNull();
    expect(storyWordCountInRange(words(200))).toBeNull();
  });

  it('rejects 119 and 201 words', () => {
    expect(storyWordCountInRange(words(119))).toMatch(/has 119 words/);
    expect(storyWordCountInRange(words(201))).toMatch(/has 201 words/);
  });

  it('ignores punctuation-only tokens', () => {
    expect(countWords('one , two - three ...')).toBe(3);
  });
});

describe('sentence counts', () => {
  it('counts sentences', () => {
    expect(countSentences('One. Two! Three?')).toBe(3);
    expect(countSentences('No final punctuation')).toBe(1);
    expect(countSentences('')).toBe(0);
  });

  it('does not split on "c. 1400" or lowercase continuations', () => {
    expect(countSentences('Attested c. 1400 in Middle English. From Latin.')).toBe(2);
  });

  it('handles closing quotes', () => {
    expect(countSentences('It meant “a humming.” Later it meant a whisper.')).toBe(2);
  });

  it('allows a 1–2 sentence definition', () => {
    expect(definitionSentenceCountInRange('One. Two.')).toBeNull();
    expect(definitionSentenceCountInRange('One. Two. Three.')).toMatch(/has 3 sentences; it must have 1 to 2/);
  });

  it('allows a 2–4 sentence etymology', () => {
    expect(etymologySentenceCountInRange('Only one sentence.')).toMatch(/has 1 sentence;/);
    expect(etymologySentenceCountInRange('One. Two. Three. Four.')).toBeNull();
    expect(etymologySentenceCountInRange('One. Two. Three. Four. Five.')).not.toBeNull();
  });
});

describe('dateIsFree', () => {
  const existing = new Set(['2026-09-24', '2026-09-25']);

  it('passes for an unused date', () => {
    expect(dateIsFree('2026-09-26', existing)).toBeNull();
  });

  it('fails on a collision', () => {
    expect(dateIsFree('2026-09-25', existing)).toMatch(/already has an entry/);
  });
});
