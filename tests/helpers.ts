import type { Entry, TextOutput } from '../pipeline/schema';

/** A 167-word story that uses the word and follows house style. */
export const VALID_STORY =
  'Every Saturday, Maren took her flask of tea to the lock at Foxton and settled on the same iron bollard. ' +
  'She had never owned a boat, never wanted one, and could not have told you the difference between a windlass and a tiller pin. ' +
  'She simply liked to watch. The narrowboats rose and fell in the chambers like slow, patient lungs, and the people aboard ' +
  'shouted cheerful instructions at one another that nobody ever followed. One afternoon a boy asked her what she was doing there. ' +
  '"I am a gongoozler," she said, and he laughed, because it sounded like a word she had invented on the spot. ' +
  'She showed him how the paddles worked, how the water found its level, and how the heavy gates swung shut with a sigh. ' +
  'By evening he had a flask of his own, and the bollard beside hers was no longer empty. ' +
  'The following spring he brought his sister, and she brought a folding chair and a notebook full of questions.';

export function validTextOutput(overrides: Partial<TextOutput> = {}): TextOutput {
  return {
    pronunciation: '/ɡɒŋˈɡuːzlə/',
    partOfSpeech: 'noun',
    definition: 'A person who idly watches boats and activity on a canal. More broadly, an onlooker who stares at anything unusual.',
    etymology:
      'Probably from Lincolnshire dialect gawn and gooze, both meaning to stare or gape. The word first appears in the early twentieth century among canal workers.',
    story: VALID_STORY,
    imagePrompt: 'a lone figure on an iron bollard beside a canal lock, watching a narrowboat rise',
    imageAlt: 'A person sitting beside a canal lock, watching a narrowboat rise in the chamber.',
    ...overrides,
  };
}

export function validEntry(overrides: Partial<Entry> = {}): Entry {
  const text = validTextOutput();
  return {
    slug: 'gongoozler',
    word: 'gongoozler',
    date: '2026-09-25',
    status: 'approved',
    pronunciation: text.pronunciation,
    partOfSpeech: text.partOfSpeech,
    definition: text.definition,
    etymology: text.etymology,
    etymologySources: ['https://en.wiktionary.org/wiki/gongoozler'],
    story: text.story,
    image: {
      url: 'https://images.example.com/2026-09-25-gongoozler-abc123.jpg',
      prompt: 'STYLE PREAMBLE. Subject: a lone figure on an iron bollard beside a canal lock',
      provider: 'fal',
      model: 'fal-ai/flux-2-pro',
      alt: text.imageAlt,
    },
    generatedAt: '2026-09-11T06:00:00.000Z',
    ...overrides,
  };
}
