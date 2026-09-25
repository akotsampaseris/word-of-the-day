/**
 * Mock source provider: no network. The URL uses the reserved ".invalid"
 * domain so mock content can never be mistaken for a real citation.
 */
import { slugify } from '../slug';
import type { SourceMaterial, SourceProvider } from './types';

export function createMockSourceProvider(): SourceProvider {
  return {
    name: 'mock',
    async fetch(word: string): Promise<SourceMaterial> {
      const url = `https://example.invalid/mock-source/${slugify(word)}`;
      return {
        word,
        urls: [url],
        sections: [
          {
            url,
            language: 'English',
            title: word,
            etymology: 'Mock source material. No dictionary was consulted.',
            pronunciations: [],
            definitions: [],
          },
        ],
      };
    },
  };
}
