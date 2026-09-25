/**
 * OpenAI image generation. Selected with IMAGE_PROVIDER=openai.
 * With style anchors, the images.edit endpoint receives them as input images.
 */
import OpenAI, { toFile } from 'openai';
import { downloadImage } from './download';
import type { ImageProvider } from './types';

export interface OpenAIImageOptions {
  apiKey: string;
  model: string;
  /** Injectable for tests. */
  client?: OpenAI;
  fetchImpl?: typeof fetch;
}

export function createOpenAIImageProvider(options: OpenAIImageOptions): ImageProvider {
  const client = options.client ?? new OpenAI({ apiKey: options.apiKey, maxRetries: 3 });

  return {
    name: 'openai',
    model: options.model,
    supportsReferenceImages: true,
    async generate(request) {
      const size = `${request.width}x${request.height}`;

      let response: OpenAI.ImagesResponse;
      if (request.referenceImageUrls.length > 0) {
        // images.edit takes uploaded files rather than URLs.
        const references = await Promise.all(
          request.referenceImageUrls.map(async (url, index) => {
            const image = await downloadImage(url, options.fetchImpl);
            return toFile(image.bytes, `reference-${index + 1}.${image.extension}`, { type: image.contentType });
          }),
        );
        response = await client.images.edit({
          model: options.model,
          prompt: request.prompt,
          image: references,
          size,
          output_format: 'jpeg',
        });
      } else {
        response = await client.images.generate({
          model: options.model,
          prompt: request.prompt,
          size,
          output_format: 'jpeg',
          n: 1,
        });
      }

      const base64 = response.data?.[0]?.b64_json;
      if (!base64) throw new Error('OpenAI returned no image data.');
      return { bytes: Buffer.from(base64, 'base64'), contentType: 'image/jpeg', extension: 'jpg' };
    },
  };
}
