/**
 * Turns the resolved config into concrete provider objects.
 * This is the only file that knows which implementations exist.
 */
import type { Config } from '../config';
import { createLocalImageStore } from '../storage/local';
import { createMockImageProvider } from './image-mock';
import { createMockSourceProvider } from './source-mock';
import { createMockTextProvider } from './text-mock';
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
    store: createImageStore(config),
  };
}

function createTextProvider(config: Config): TextProvider {
  switch (config.text.provider) {
    case 'mock':
      return createMockTextProvider();
    default:
      throw new Error(`Text provider "${config.text.provider}" is not implemented yet.`);
  }
}

function createImageProvider(config: Config): ImageProvider {
  switch (config.image.provider) {
    case 'mock':
      return createMockImageProvider();
    default:
      throw new Error(`Image provider "${config.image.provider}" is not implemented yet.`);
  }
}

function createSourceProvider(config: Config): SourceProvider {
  switch (config.source.provider) {
    case 'mock':
      return createMockSourceProvider();
    default:
      throw new Error(`Source provider "${config.source.provider}" is not implemented yet.`);
  }
}

function createImageStore(config: Config): ImageStore {
  if (config.s3) throw new Error('S3 storage is not implemented yet.');
  return createLocalImageStore();
}
