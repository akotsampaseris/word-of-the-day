/**
 * Turns the resolved config into concrete provider objects.
 * This is the only file that knows which implementations exist: adding a
 * provider (say, Google's image model) means one new adapter file, one case
 * here, and one name in config.ts.
 */
import type { Config } from '../config';
import { createLocalImageStore } from '../storage/local';
import { createS3ImageStore } from '../storage/s3';
import { createFalImageProvider } from './image-fal';
import { createMockImageProvider } from './image-mock';
import { createOpenAIImageProvider } from './image-openai';
import { createMockSourceProvider } from './source-mock';
import { createWiktionarySourceProvider } from './source-wiktionary';
import { createAnthropicTextProvider } from './text-anthropic';
import { createMockTextProvider } from './text-mock';
import { createOpenAITextProvider } from './text-openai';
import type { ImageProvider, ImageStore, SourceProvider, TextProvider } from './types';

export interface Providers {
  text: TextProvider;
  image: ImageProvider;
  source: SourceProvider;
  store: ImageStore;
}

export function createProviders(config: Config): Providers {
  return {
    text: createTextProvider(config),
    image: createImageProvider(config),
    source: createSourceProvider(config),
    store: config.s3 ? createS3ImageStore(config.s3) : createLocalImageStore(),
  };
}

function createTextProvider({ text }: Config): TextProvider {
  switch (text.provider) {
    case 'anthropic':
      return createAnthropicTextProvider({ apiKey: text.apiKey!, model: text.model });
    case 'openai':
      return createOpenAITextProvider({ apiKey: text.apiKey!, model: text.model });
    case 'mock':
      return createMockTextProvider();
  }
}

function createImageProvider({ image }: Config): ImageProvider {
  switch (image.provider) {
    case 'fal':
      return createFalImageProvider({ apiKey: image.apiKey!, model: image.model });
    case 'openai':
      return createOpenAIImageProvider({ apiKey: image.apiKey!, model: image.model });
    case 'mock':
      return createMockImageProvider();
  }
}

function createSourceProvider({ source }: Config): SourceProvider {
  switch (source.provider) {
    case 'wiktionary':
      return createWiktionarySourceProvider({ userAgent: source.userAgent });
    case 'mock':
      return createMockSourceProvider();
  }
}
