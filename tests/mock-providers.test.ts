import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMockImageProvider, renderMockSvg } from '../pipeline/providers/image-mock';
import { createMockSourceProvider } from '../pipeline/providers/source-mock';
import { createMockTextProvider } from '../pipeline/providers/text-mock';
import { checkContentRules } from '../pipeline/rules';
import { TextOutputSchema } from '../pipeline/schema';
import { createLocalImageStore } from '../pipeline/storage/local';

const SAMPLE_WORDS = ['gongoozler', 'zugzwang', 'ort', 'ultracrepidarian', 'will-o-the-wisp'];

describe('mock text provider', () => {
  const text = createMockTextProvider();
  const source = createMockSourceProvider();

  // Every story variant (seeds 0, 1, 2) must pass every rule for any word,
  // otherwise mock mode would produce failed drafts.
  for (const word of SAMPLE_WORDS) {
    for (const seed of [0, 1, 2]) {
      it(`produces valid content for "${word}" (seed ${seed})`, async () => {
        const raw = await text.complete({ system: '', messages: [], seed, word });
        const output = TextOutputSchema.parse(JSON.parse(raw));
        const material = (await source.fetch(word))!;
        expect(checkContentRules({ ...output, word, etymologySources: material.urls })).toEqual([]);
      });
    }
  }

  it('is deterministic', async () => {
    const request = { system: '', messages: [], seed: 7, word: 'gongoozler' };
    expect(await text.complete(request)).toBe(await text.complete(request));
  });
});

describe('mock source provider', () => {
  it('returns a clearly fake, well-formed source URL', async () => {
    const material = (await createMockSourceProvider().fetch('Zugzwang'))!;
    expect(material.urls).toEqual(['https://example.invalid/mock-source/zugzwang']);
  });
});

describe('mock image provider', () => {
  it('draws a square SVG containing the word', async () => {
    const image = await createMockImageProvider().generate({
      prompt: 'anything',
      width: 1024,
      height: 1024,
      referenceImageUrls: [],
      seed: 3,
      word: 'gongoozler',
    });
    const svg = new TextDecoder().decode(image.bytes);
    expect(image.contentType).toBe('image/svg+xml');
    expect(svg).toContain('width="1024" height="1024"');
    expect(svg).toContain('>gongoozler</text>');
  });

  it('is deterministic for the same word and seed', () => {
    expect(renderMockSvg('ort', 42)).toBe(renderMockSvg('ort', 42));
  });

  it('escapes the word for XML', () => {
    expect(renderMockSvg('<b>&"', 1)).toContain('&lt;b&gt;&amp;&quot;');
  });
});

describe('local image store', () => {
  it('writes the file and returns a site-relative URL', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'wotd-images-'));
    const store = createLocalImageStore(directory);
    const url = await store.put('2026-09-25-ort-abc.svg', {
      bytes: new TextEncoder().encode('<svg/>'),
      contentType: 'image/svg+xml',
      extension: 'svg',
    });
    expect(url).toBe('/mock-images/2026-09-25-ort-abc.svg');
    expect(await readFile(path.join(directory, '2026-09-25-ort-abc.svg'), 'utf8')).toBe('<svg/>');
  });
});
