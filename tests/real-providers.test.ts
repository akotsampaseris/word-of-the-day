/**
 * The real provider adapters, tested offline with fake SDK clients. These
 * check what we send and how we read the reply; they cannot prove the remote
 * APIs behave as documented, so do one real `pnpm pipeline:generate --days 0`
 * run after adding keys.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../pipeline/config';
import { createProviders } from '../pipeline/providers';
import { createFalImageProvider } from '../pipeline/providers/image-fal';
import { createOpenAIImageProvider } from '../pipeline/providers/image-openai';
import { createAnthropicTextProvider } from '../pipeline/providers/text-anthropic';
import { createOpenAITextProvider } from '../pipeline/providers/text-openai';
import type { ImageRequest, TextRequest } from '../pipeline/providers/types';
import { createS3ImageStore } from '../pipeline/storage/s3';

const TEXT_REQUEST: TextRequest = {
  system: 'SYSTEM',
  messages: [
    { role: 'user', content: 'write it' },
    { role: 'assistant', content: 'bad reply' },
    { role: 'user', content: 'fix it' },
  ],
  seed: 1,
  word: 'gongoozler',
};

const IMAGE_REQUEST: ImageRequest = {
  prompt: 'STYLE. Subject: a canal.',
  width: 1024,
  height: 1024,
  referenceImageUrls: [],
  seed: 4_000_000_000,
  word: 'gongoozler',
};

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

const imageFetch = (async () =>
  new Response(JPEG_BYTES, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })) as unknown as typeof fetch;

describe('Anthropic text provider', () => {
  it('sends the system prompt and the whole conversation, and joins the text blocks', async () => {
    const calls: unknown[] = [];
    const client = {
      messages: {
        async create(params: unknown) {
          calls.push(params);
          return { content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] };
        },
      },
    } as unknown as Anthropic;

    const provider = createAnthropicTextProvider({ apiKey: 'k', model: 'claude-haiku-4-5', client });
    expect(await provider.complete(TEXT_REQUEST)).toBe('{"a":1}');
    expect(calls[0]).toEqual({
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
      system: 'SYSTEM',
      messages: TEXT_REQUEST.messages,
    });
  });
});

describe('OpenAI text provider', () => {
  it('uses the Responses API with instructions and input messages', async () => {
    const calls: unknown[] = [];
    const client = {
      responses: {
        async create(params: unknown) {
          calls.push(params);
          return { output_text: '{"a":1}' };
        },
      },
    } as unknown as OpenAI;

    const provider = createOpenAITextProvider({ apiKey: 'k', model: 'gpt-6-luna', client });
    expect(await provider.complete(TEXT_REQUEST)).toBe('{"a":1}');
    expect(calls[0]).toEqual({ model: 'gpt-6-luna', instructions: 'SYSTEM', input: TEXT_REQUEST.messages });
  });
});

describe('fal image provider (FLUX.2 pro)', () => {
  function fakeFal() {
    const calls: { endpoint: string; input: Record<string, unknown> }[] = [];
    const client = {
      async subscribe(endpoint: string, options: { input: Record<string, unknown> }) {
        calls.push({ endpoint, input: options.input });
        return { data: { images: [{ url: 'https://fal.media/files/abc.jpg' }] }, requestId: 'req-1' };
      },
    };
    return { client: client as never, calls };
  }

  it('uses text-to-image at 1024×1024 when there are no style anchors', async () => {
    const { client, calls } = fakeFal();
    const provider = createFalImageProvider({ apiKey: 'k', model: 'fal-ai/flux-2-pro', client, fetchImpl: imageFetch });
    const image = await provider.generate(IMAGE_REQUEST);

    expect(calls).toEqual([
      {
        endpoint: 'fal-ai/flux-2-pro',
        input: {
          prompt: IMAGE_REQUEST.prompt,
          image_size: { width: 1024, height: 1024 },
          seed: 4_000_000_000 % 2_147_483_647,
          output_format: 'jpeg',
        },
      },
    ]);
    expect(image).toEqual({ bytes: JPEG_BYTES, contentType: 'image/jpeg', extension: 'jpg' });
  });

  it('uses the /edit endpoint with image_urls when style anchors are given', async () => {
    const { client, calls } = fakeFal();
    const provider = createFalImageProvider({ apiKey: 'k', model: 'fal-ai/flux-2-pro', client, fetchImpl: imageFetch });
    const anchors = ['https://img.example.com/1.jpg', 'https://img.example.com/2.jpg'];
    await provider.generate({ ...IMAGE_REQUEST, referenceImageUrls: anchors });

    expect(calls[0]!.endpoint).toBe('fal-ai/flux-2-pro/edit');
    expect(calls[0]!.input.image_urls).toEqual(anchors);
  });
});

describe('OpenAI image provider', () => {
  it('decodes the base64 image from images.generate', async () => {
    const calls: unknown[] = [];
    const client = {
      images: {
        async generate(params: unknown) {
          calls.push(params);
          return { data: [{ b64_json: Buffer.from(JPEG_BYTES).toString('base64') }] };
        },
      },
    } as unknown as OpenAI;

    const provider = createOpenAIImageProvider({ apiKey: 'k', model: 'gpt-image-2.5-sunburst', client });
    const image = await provider.generate(IMAGE_REQUEST);
    expect(new Uint8Array(image.bytes)).toEqual(JPEG_BYTES);
    expect(calls[0]).toMatchObject({ size: '1024x1024', output_format: 'jpeg', model: 'gpt-image-2.5-sunburst' });
  });

  it('uploads the style anchors as input images to images.edit', async () => {
    const calls: { image: File[] }[] = [];
    const client = {
      images: {
        async edit(params: { image: File[] }) {
          calls.push(params);
          return { data: [{ b64_json: Buffer.from(JPEG_BYTES).toString('base64') }] };
        },
      },
    } as unknown as OpenAI;

    const provider = createOpenAIImageProvider({ apiKey: 'k', model: 'm', client, fetchImpl: imageFetch });
    await provider.generate({ ...IMAGE_REQUEST, referenceImageUrls: ['https://img.example.com/1.jpg'] });
    expect(calls[0]!.image.map((file) => file.name)).toEqual(['reference-1.jpg']);
  });
});

describe('S3 image store', () => {
  it('uploads with the key prefix, content type and long cache, and returns the public URL', async () => {
    const sent: { input: Record<string, unknown> }[] = [];
    const client = { send: async (command: { input: Record<string, unknown> }) => sent.push(command) };
    const settings = loadConfig({
      S3_BUCKET: 'wotd',
      S3_ACCESS_KEY_ID: 'a',
      S3_SECRET_ACCESS_KEY: 'b',
      S3_PUBLIC_BASE_URL: 'https://images.example.com',
      S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    }).s3!;

    const store = createS3ImageStore(settings, client as never);
    const url = await store.put('2026-09-25-ort-abc.jpg', { bytes: JPEG_BYTES, contentType: 'image/jpeg', extension: 'jpg' });

    expect(url).toBe('https://images.example.com/images/2026-09-25-ort-abc.jpg');
    expect(sent[0]!.input).toMatchObject({
      Bucket: 'wotd',
      Key: 'images/2026-09-25-ort-abc.jpg',
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    });
  });
});

describe('createProviders', () => {
  it('builds the real providers from config', () => {
    const providers = createProviders(
      loadConfig({
        ANTHROPIC_API_KEY: 'k',
        FAL_KEY: 'f',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 's',
        S3_PUBLIC_BASE_URL: 'https://images.example.com',
      }),
    );
    expect([providers.text.name, providers.image.name, providers.source.name, providers.store.name]).toEqual([
      'anthropic',
      'fal',
      'wiktionary',
      's3',
    ]);
    expect(providers.text.model).toBe('claude-haiku-4-5');
  });

  it('builds all mocks from an empty environment', () => {
    const providers = createProviders(loadConfig({}));
    expect([providers.text.name, providers.image.name, providers.source.name, providers.store.name]).toEqual([
      'mock',
      'mock',
      'mock',
      'local',
    ]);
  });
});
