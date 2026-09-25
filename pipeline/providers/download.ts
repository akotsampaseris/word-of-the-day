import type { GeneratedImage } from './types';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** Downloads an image URL into memory (providers like fal return a temporary URL). */
export async function downloadImage(url: string, fetchImpl: typeof fetch = fetch): Promise<GeneratedImage> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Could not download image (HTTP ${response.status}): ${url}`);
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType,
    extension: EXTENSIONS[contentType] ?? 'jpg',
  };
}
