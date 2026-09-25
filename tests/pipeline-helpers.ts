import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  ImageProvider,
  ImageRequest,
  SourceProvider,
  TextProvider,
  TextRequest,
} from '../pipeline/providers/types';
import { createMockSourceProvider } from '../pipeline/providers/source-mock';

/** A temporary content directory with the given words.json and content files. */
export async function makeContentDir(words: string[], files: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wotd-content-'));
  await writeFile(path.join(dir, 'words.json'), JSON.stringify(words));
  for (const [name, data] of Object.entries(files)) {
    await writeFile(path.join(dir, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }
  return dir;
}

/**
 * A text provider that replies from a script, one reply per call, and records
 * every request so tests can inspect the repair messages. A reply can also be
 * an Error, which is thrown (simulating an outage).
 */
export function scriptedTextProvider(replies: (string | Error)[]) {
  const requests: TextRequest[] = [];
  const provider: TextProvider = {
    name: 'scripted',
    model: 'scripted-1',
    async complete(request) {
      requests.push(structuredClone(request));
      const reply = replies.shift();
      if (reply === undefined) throw new Error('scriptedTextProvider ran out of replies');
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return { provider, requests };
}

/** An image provider that records requests and returns a few fixed bytes. */
export function recordingImageProvider(options: { supportsReferenceImages: boolean }) {
  const requests: ImageRequest[] = [];
  const provider: ImageProvider = {
    name: 'recording',
    model: 'recording-1',
    supportsReferenceImages: options.supportsReferenceImages,
    async generate(request) {
      requests.push(structuredClone(request));
      return { bytes: new TextEncoder().encode(`image for ${request.word}`), contentType: 'image/png', extension: 'png' };
    },
  };
  return { provider, requests };
}

/** The mock source provider, except that some words have no etymology. */
export function sourceProviderWithout(missingWords: string[]): SourceProvider {
  const mock = createMockSourceProvider();
  return {
    name: 'test-source',
    async fetch(word) {
      return missingWords.includes(word) ? null : mock.fetch(word);
    },
  };
}
