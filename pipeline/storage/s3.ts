/**
 * S3-compatible image storage (AWS S3, Cloudflare R2, MinIO, ...).
 *
 * For R2, set S3_ENDPOINT to https://<account-id>.r2.cloudflarestorage.com;
 * the region then defaults to "auto". The bucket must be publicly readable
 * at S3_PUBLIC_BASE_URL (an R2 public bucket URL or custom domain, or an S3
 * bucket/CloudFront URL). The returned URL is what goes into the entry JSON.
 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { S3Settings } from '../config';
import type { GeneratedImage, ImageStore } from '../providers/types';

export function createS3ImageStore(settings: S3Settings, client?: Pick<S3Client, 'send'>): ImageStore {
  const s3 =
    client ??
    new S3Client({
      region: settings.region,
      endpoint: settings.endpoint,
      forcePathStyle: settings.forcePathStyle,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    });

  return {
    name: 's3',
    async put(key: string, image: GeneratedImage): Promise<string> {
      const objectKey = `${settings.keyPrefix}${key}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: settings.bucket,
          Key: objectKey,
          Body: image.bytes,
          ContentType: image.contentType,
          // Keys contain a content hash, so an object never changes: cache it forever.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${settings.publicBaseUrl}/${objectKey}`;
    },
  };
}
