/**
 * Mock text provider: deterministic, seeded, no network.
 *
 * It returns obviously-placeholder content that nevertheless passes every
 * schema check and content rule, so the whole pipeline and the site can be
 * exercised without an API key. The definition and etymology say plainly that
 * they are placeholders: a plausible-sounding fake etymology is exactly the
 * failure this project is designed to avoid.
 */
import { pick } from '../seed';
import type { TextOutput } from '../schema';
import type { TextProvider, TextRequest } from './types';

// Each story is 120–200 words, has no em-dashes, and uses {word} in quotes so
// it reads correctly whatever the word's part of speech.
const STORIES = [
  'The lighthouse keeper kept a tin box of words that visitors left behind. Most were ordinary: harbour, kettle, rain. ' +
    'On the first cold morning of the year she found a new card wedged under the door, and on it, in careful green ink, ' +
    'was the word "{word}". She did not know what it meant. She said it aloud to the gulls, who were unimpressed, and then ' +
    'to the lamp, which was patient with her as always. By noon she had decided it must describe the particular silver of ' +
    'the sea before a storm. By evening she was sure it was the name of a small, stubborn fish. That night she wrote both ' +
    'guesses on the back of the card and filed it with the others. Somewhere, she hoped, a stranger was waiting to tell her ' +
    'she was wrong. Until then, "{word}" belonged to her, and she said it every time the light came round.',
  'Oskar ran the only bakery on Tanners Lane, and every morning he chalked a single word above the bread. Customers argued ' +
    'about the words more than they argued about the prices. On Thursday the board said "{word}", and nobody in the queue ' +
    'would admit that they had never heard it. The schoolteacher nodded as if she used it daily. The postman frowned, then ' +
    'smiled, then bought two loaves to buy himself time. A small girl near the door simply asked what it meant, and the whole ' +
    'shop went quiet. Oskar wiped his hands on his apron and confessed that he had found it in a library book and liked the ' +
    "shape of it. So they looked it up together on the girl's mother's phone, crowded round the screen among the flour and " +
    'the steam. After that, "{word}" stayed on the board for a week, which was the longest any word had ever lasted.',
  'On the slow train north, two strangers shared a table and a crossword. Neither of them was any good at it. The older one, ' +
    'a retired surveyor with a pencil behind each ear, insisted that seven down was "{word}". The younger one, who had a ' +
    'guitar case and a cold, insisted that no such word existed. They argued through three stations and a tunnel. A conductor ' +
    'stopped to listen and took no side, although he wrote the word on his hand. By the time the hills turned white with ' +
    'frost they had filled in every other square and left that one empty, like a seat saved for someone who might still ' +
    'arrive. At the last stop they shook hands and went their separate ways. Years later, the younger one wrote a song and ' +
    'called it "{word}", and never once explained the title to anyone.',
];

const SCENES = [
  'a lighthouse at dusk with a single card pinned to its door',
  'a small bakery window at dawn with a chalkboard above the loaves',
  'two strangers at a train table bent over a crossword',
];

export function createMockTextProvider(): TextProvider {
  return {
    name: 'mock',
    model: 'mock-text-v1',
    async complete(request: TextRequest): Promise<string> {
      return JSON.stringify(mockTextOutput(request.word, request.seed));
    },
  };
}

export function mockTextOutput(word: string, seed: number): TextOutput {
  return {
    pronunciation: '/ˈplæs.həʊl.də/',
    partOfSpeech: 'placeholder',
    definition:
      'Placeholder definition written by the mock text provider. Run the pipeline with a real text provider to get the actual meaning.',
    etymology:
      'No etymology was fetched, because the pipeline ran in mock mode. With real providers, this paragraph is rewritten from the Wiktionary entry listed under sources.',
    story: pick(STORIES, seed).replaceAll('{word}', word),
    imagePrompt: pick(SCENES, seed),
    imageAlt: `Placeholder image showing the word "${word}".`,
  };
}
