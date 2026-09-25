/**
 * FLUX.2 [pro] on fal.ai (the default image provider).
 *
 *   fal-ai/flux-2-pro        text to image
 *   fal-ai/flux-2-pro/edit   the same model with reference images (`image_urls`)
 *
 * When style anchors are available we call the /edit endpoint and pass them
 * as references; the prompt (see style.ts) tells the model to borrow only the
 * style from them, not the subject. Set IMAGE_MODEL to try another fal model
 * that follows the same "<id>" + "<id>/edit" convention.
 */
import { createFalClient, type FalClient } from '@fal-ai/client';
import { downloadImage } from './download';
import type { ImageProvider } from './types';

export interface FalOptions {
  apiKey: string;
  model: string;
  /** Injectable for tests. */
  client?: Pick<FalClient, 'subscribe'>;
  fetchImpl?: typeof fetch;
}

interface FalImageResult {
  images: { url: string }[];
}

export function createFalImageProvider(options: FalOptions): ImageProvider {
  const client = options.client ?? createFalClient({ credentials: options.apiKey });

  return {
    name: 'fal',
    model: options.model,
    supportsReferenceImages: true,
    async generate(request) {
      const input = {
        prompt: request.prompt,
        image_size: { width: request.width, height: request.height },
        seed: request.seed % 2_147_483_647, // keep it within a 32-bit signed integer
        output_format: 'jpeg',
      };

      // subscribe() submits to fal's queue and waits for the result.
      const useReferences = request.referenceImageUrls.length > 0;
      const result = useReferences
        ? await client.subscribe(`${options.model}/edit`, { input: { ...input, image_urls: request.referenceImageUrls } })
        : await client.subscribe(options.model, { input });

      const url = (result.data as FalImageResult).images?.[0]?.url;
      if (!url) throw new Error(`fal returned no image (request ${result.requestId}).`);

      // fal's URLs are temporary, so download the bytes and store them ourselves.
      return downloadImage(url, options.fetchImpl);
    },
  };
}
