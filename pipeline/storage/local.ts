/**
 * Local image store, used with the mock image provider. Writes into
 * public/mock-images/ (gitignored) and returns a site-relative URL.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MOCK_IMAGES_DIR } from '../paths';
import type { GeneratedImage, ImageStore } from '../providers/types';

export const MOCK_IMAGES_URL_PREFIX = '/mock-images/';

export function createLocalImageStore(directory: string = MOCK_IMAGES_DIR): ImageStore {
  return {
    name: 'local',
    async put(key: string, image: GeneratedImage): Promise<string> {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, key), image.bytes);
      return `${MOCK_IMAGES_URL_PREFIX}${key}`;
    },
  };
}
