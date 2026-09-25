/**
 * Mock images are not committed (images never live in git), so a clean
 * checkout has content files pointing at /mock-images/... files that do not
 * exist yet. This recreates them. It runs before every `pnpm dev` and
 * `pnpm build`, and is safe to run repeatedly: it only writes missing files.
 *
 * Because the mock image provider is deterministic, the recreated SVG is
 * identical to the one originally generated.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadContent } from './content-store';
import { renderMockSvg } from './providers/image-mock';
import { seedFor } from './seed';
import { MOCK_IMAGES_URL_PREFIX } from './storage/local';

export async function ensureMockImages(contentDir: string, imagesDir: string): Promise<number> {
  const files = await loadContent(contentDir);
  let written = 0;

  for (const file of files) {
    if (file.kind !== 'entry') continue;
    const { word, date, slug, image } = file.entry;
    if (!image.url.startsWith(MOCK_IMAGES_URL_PREFIX)) continue;

    // basename() so a hand-edited URL can never write outside imagesDir.
    const target = path.join(imagesDir, path.basename(image.url));
    if (existsSync(target)) continue;

    await mkdir(imagesDir, { recursive: true });
    await writeFile(target, renderMockSvg(word, seedFor(date, slug)));
    written++;
  }

  return written;
}
