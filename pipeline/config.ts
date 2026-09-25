/**
 * Reads configuration from environment variables (and .env, if present).
 *
 * Two rules shape this file:
 *   1. Missing keys never throw. A provider without its key falls back to the
 *      mock provider, with a warning, so a clean checkout always works.
 *      (Set REQUIRE_REAL_PROVIDERS=1 in CI to turn that fallback into an error.)
 *   2. Secret values are never printed. describeConfig() reports only which
 *      providers are active, and redactSecrets() scrubs error messages.
 */
import { existsSync } from 'node:fs';
import { isValidTimeZone } from './dates';
import { ENV_FILE } from './paths';

export type TextProviderName = 'anthropic' | 'openai' | 'mock';
export type ImageProviderName = 'fal' | 'openai' | 'mock';
export type SourceProviderName = 'wiktionary' | 'mock';

// Checked against the providers' docs in September 2026. Override with TEXT_MODEL / IMAGE_MODEL.
export const DEFAULT_TEXT_MODELS: Record<TextProviderName, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-6-luna',
  mock: 'mock-text-v1',
};

export const DEFAULT_IMAGE_MODELS: Record<ImageProviderName, string> = {
  fal: 'fal-ai/flux-2-pro',
  openai: 'gpt-image-2.5-sunburst',
  mock: 'mock-svg-v1',
};

/** Env vars whose values must never appear in logs. */
export const SECRET_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'FAL_KEY',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

export interface S3Settings {
  bucket: string;
  region: string;
  endpoint: string | undefined;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public URL prefix the bucket is served from, e.g. https://images.example.com */
  publicBaseUrl: string;
  keyPrefix: string;
}

export interface Config {
  siteUrl: string;
  timeZone: string;
  bufferDays: number;
  maxAttempts: number;
  text: { provider: TextProviderName; model: string; apiKey: string | undefined };
  image: { provider: ImageProviderName; model: string; apiKey: string | undefined };
  source: { provider: SourceProviderName; userAgent: string };
  /** Undefined means images are written to public/mock-images instead. */
  s3: S3Settings | undefined;
  /** Pinned style anchors. When empty, the 3 most recent approved images are used. */
  styleAnchorUrls: string[];
  /** Human-readable notes about fallbacks, printed by the CLI. */
  warnings: string[];
}

type Env = Record<string, string | undefined>;

/** Loads .env into process.env if the file exists. Real env vars take precedence. */
export function loadEnvFile(file: string = ENV_FILE): void {
  if (existsSync(file)) process.loadEnvFile(file);
}

export function loadConfig(env: Env = process.env): Config {
  const warnings: string[] = [];
  const get = (name: string) => {
    const value = env[name]?.trim();
    return value ? value : undefined;
  };

  const siteUrl = (get('SITE_URL') ?? 'http://localhost:4321').replace(/\/+$/, '');
  const timeZone = get('SITE_TIMEZONE') ?? 'UTC';
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`SITE_TIMEZONE "${timeZone}" is not a valid IANA time zone (e.g. "UTC", "Europe/Athens").`);
  }

  const s3 = readS3Settings(get, warnings);
  const text = chooseTextProvider(get, warnings);
  const image = chooseImageProvider(get, warnings, s3 !== undefined);
  const source = chooseSourceProvider(get, text.provider);

  const config: Config = {
    siteUrl,
    timeZone,
    bufferDays: readInteger(get, 'BUFFER_DAYS', 14, 1, 60),
    maxAttempts: readInteger(get, 'MAX_ATTEMPTS', 3, 1, 10),
    text,
    image,
    source: {
      provider: source,
      userAgent:
        get('WIKTIONARY_USER_AGENT') ?? `word-of-the-day-pipeline/0.1 (${siteUrl}; set WIKTIONARY_USER_AGENT)`,
    },
    s3,
    styleAnchorUrls: (get('STYLE_ANCHOR_URLS') ?? '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean),
    warnings,
  };

  if (isTruthy(get('REQUIRE_REAL_PROVIDERS'))) {
    const mocked = [
      config.text.provider === 'mock' && 'text',
      config.image.provider === 'mock' && 'image',
      config.source.provider === 'mock' && 'source',
      config.s3 === undefined && 'storage (S3)',
    ].filter(Boolean);
    if (mocked.length > 0) {
      throw new Error(
        `REQUIRE_REAL_PROVIDERS is set but these would use mocks: ${mocked.join(', ')}.` +
          (warnings.length > 0 ? `\n  ${warnings.join('\n  ')}` : ''),
      );
    }
  }

  return config;
}

/** One line per provider, safe to print: names and models only, never keys. */
export function describeConfig(config: Config): string[] {
  const storage = config.s3 ? `s3 (bucket "${config.s3.bucket}")` : 'local (public/mock-images)';
  return [
    `text:    ${config.text.provider} (${config.text.model})`,
    `image:   ${config.image.provider} (${config.image.model})`,
    `source:  ${config.source.provider}`,
    `storage: ${storage}`,
  ];
}

/** Replaces any secret env value found in `message` with [redacted]. */
export function redactSecrets(message: string, env: Env = process.env): string {
  let result = message;
  for (const name of SECRET_ENV_VARS) {
    const value = env[name]?.trim();
    if (value && value.length >= 4) result = result.replaceAll(value, '[redacted]');
  }
  return result;
}

// ---------------------------------------------------------------------------

type Getter = (name: string) => string | undefined;

function chooseTextProvider(get: Getter, warnings: string[]): Config['text'] {
  const requested = (get('TEXT_PROVIDER') ?? 'auto').toLowerCase();
  const keys: Record<Exclude<TextProviderName, 'mock'>, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
  };

  let provider: TextProviderName;
  if (requested === 'auto') {
    provider = get(keys.anthropic) ? 'anthropic' : 'mock';
  } else if (requested === 'anthropic' || requested === 'openai') {
    provider = requested;
    if (!get(keys[requested])) {
      warnings.push(`TEXT_PROVIDER=${requested} but ${keys[requested]} is not set; using the mock text provider.`);
      provider = 'mock';
    }
  } else if (requested === 'mock') {
    provider = 'mock';
  } else {
    throw new Error(`TEXT_PROVIDER must be auto, anthropic, openai or mock (got "${requested}").`);
  }

  return {
    provider,
    model: provider === 'mock' ? DEFAULT_TEXT_MODELS.mock : (get('TEXT_MODEL') ?? DEFAULT_TEXT_MODELS[provider]),
    apiKey: provider === 'mock' ? undefined : get(keys[provider]),
  };
}

function chooseImageProvider(get: Getter, warnings: string[], hasS3: boolean): Config['image'] {
  const requested = (get('IMAGE_PROVIDER') ?? 'auto').toLowerCase();
  const keys: Record<Exclude<ImageProviderName, 'mock'>, string> = {
    fal: 'FAL_KEY',
    openai: 'OPENAI_API_KEY',
  };

  let provider: ImageProviderName;
  if (requested === 'auto') {
    provider = get(keys.fal) ? 'fal' : 'mock';
  } else if (requested === 'fal' || requested === 'openai') {
    provider = requested;
    if (!get(keys[requested])) {
      warnings.push(`IMAGE_PROVIDER=${requested} but ${keys[requested]} is not set; using the mock image provider.`);
      provider = 'mock';
    }
  } else if (requested === 'mock') {
    provider = 'mock';
  } else {
    throw new Error(`IMAGE_PROVIDER must be auto, fal, openai or mock (got "${requested}").`);
  }

  // Real images must go to object storage. Writing them to the gitignored
  // public/mock-images folder would lose them on the next clean checkout.
  if (provider !== 'mock' && !hasS3) {
    warnings.push(`Image provider "${provider}" needs S3 storage, which is not configured; using mock images.`);
    provider = 'mock';
  }

  return {
    provider,
    model: provider === 'mock' ? DEFAULT_IMAGE_MODELS.mock : (get('IMAGE_MODEL') ?? DEFAULT_IMAGE_MODELS[provider]),
    apiKey: provider === 'mock' ? undefined : get(keys[provider]),
  };
}

function chooseSourceProvider(get: Getter, textProvider: TextProviderName): SourceProviderName {
  const requested = (get('SOURCE_PROVIDER') ?? 'auto').toLowerCase();
  if (requested === 'auto') {
    // Fetching real sources only makes sense when a real model will read them.
    return textProvider === 'mock' ? 'mock' : 'wiktionary';
  }
  if (requested === 'wiktionary' || requested === 'mock') return requested;
  throw new Error(`SOURCE_PROVIDER must be auto, wiktionary or mock (got "${requested}").`);
}

function readS3Settings(get: Getter, warnings: string[]): S3Settings | undefined {
  const required = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL'];
  const missing = required.filter((name) => !get(name));
  if (missing.length === required.length) return undefined;
  if (missing.length > 0) {
    warnings.push(`S3 is partly configured; missing ${missing.join(', ')}. Images will be stored locally.`);
    return undefined;
  }

  const endpoint = get('S3_ENDPOINT');
  return {
    bucket: get('S3_BUCKET')!,
    // Cloudflare R2 expects the region "auto".
    region: get('S3_REGION') ?? (endpoint ? 'auto' : 'us-east-1'),
    endpoint,
    // Custom endpoints (R2, MinIO) are most reliable with path-style URLs.
    forcePathStyle: get('S3_FORCE_PATH_STYLE') !== undefined ? isTruthy(get('S3_FORCE_PATH_STYLE')) : Boolean(endpoint),
    accessKeyId: get('S3_ACCESS_KEY_ID')!,
    secretAccessKey: get('S3_SECRET_ACCESS_KEY')!,
    publicBaseUrl: get('S3_PUBLIC_BASE_URL')!.replace(/\/+$/, ''),
    keyPrefix: get('S3_KEY_PREFIX') ?? 'images/',
  };
}

function readInteger(get: Getter, name: string, fallback: number, min: number, max: number): number {
  const raw = get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number between ${min} and ${max} (got "${raw}").`);
  }
  return value;
}

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}
