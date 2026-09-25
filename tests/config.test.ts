import { describe, expect, it } from 'vitest';
import { describeConfig, loadConfig, redactSecrets } from '../pipeline/config';
import { parseModelJson } from '../pipeline/parse-json';

const S3 = {
  S3_BUCKET: 'wotd-images',
  S3_ACCESS_KEY_ID: 'AKIA-TEST-ACCESS',
  S3_SECRET_ACCESS_KEY: 'super-secret-value',
  S3_PUBLIC_BASE_URL: 'https://images.example.com/',
};

describe('loadConfig', () => {
  it('uses mocks for everything with an empty environment, without warnings', () => {
    const config = loadConfig({});
    expect(config.text.provider).toBe('mock');
    expect(config.image.provider).toBe('mock');
    expect(config.source.provider).toBe('mock');
    expect(config.s3).toBeUndefined();
    expect(config.warnings).toEqual([]);
    expect(config).toMatchObject({ bufferDays: 14, maxAttempts: 3, timeZone: 'UTC', siteUrl: 'http://localhost:4321' });
  });

  it('picks Anthropic (Claude Haiku) and real sources when the key is present', () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(config.text).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: 'sk-ant-test' });
    expect(config.source.provider).toBe('wiktionary');
  });

  it('lets TEXT_MODEL override the default model', () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: 'k', TEXT_MODEL: 'claude-sonnet-5' });
    expect(config.text.model).toBe('claude-sonnet-5');
  });

  it('never picks OpenAI automatically; it must be requested', () => {
    expect(loadConfig({ OPENAI_API_KEY: 'k' }).text.provider).toBe('mock');
    expect(loadConfig({ OPENAI_API_KEY: 'k', TEXT_PROVIDER: 'openai' }).text.provider).toBe('openai');
  });

  it('degrades to mock with a warning when a requested provider has no key', () => {
    const config = loadConfig({ TEXT_PROVIDER: 'anthropic', IMAGE_PROVIDER: 'fal', ...S3 });
    expect(config.text.provider).toBe('mock');
    expect(config.image.provider).toBe('mock');
    expect(config.warnings).toEqual([
      expect.stringContaining('ANTHROPIC_API_KEY is not set'),
      expect.stringContaining('FAL_KEY is not set'),
    ]);
  });

  it('refuses real images without S3, since they would not survive a clean checkout', () => {
    const config = loadConfig({ FAL_KEY: 'fal-key' });
    expect(config.image.provider).toBe('mock');
    expect(config.warnings).toEqual([expect.stringContaining('needs S3 storage')]);
  });

  it('uses fal (FLUX.2 pro) when FAL_KEY and S3 are both configured', () => {
    const config = loadConfig({ FAL_KEY: 'fal-key', ...S3 });
    expect(config.image).toMatchObject({ provider: 'fal', model: 'fal-ai/flux-2-pro' });
    expect(config.s3).toMatchObject({ bucket: 'wotd-images', publicBaseUrl: 'https://images.example.com', keyPrefix: 'images/' });
  });

  it('configures R2-style endpoints with region auto and path-style URLs', () => {
    const config = loadConfig({ ...S3, S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com' });
    expect(config.s3).toMatchObject({ region: 'auto', forcePathStyle: true });
  });

  it('warns about partial S3 configuration', () => {
    const config = loadConfig({ S3_BUCKET: 'b' });
    expect(config.s3).toBeUndefined();
    expect(config.warnings).toEqual([expect.stringContaining('missing S3_ACCESS_KEY_ID')]);
  });

  it('throws when REQUIRE_REAL_PROVIDERS is set and anything is mocked', () => {
    expect(() => loadConfig({ REQUIRE_REAL_PROVIDERS: '1' })).toThrow(/text, image, source, storage/);
    expect(() =>
      loadConfig({ REQUIRE_REAL_PROVIDERS: 'true', ANTHROPIC_API_KEY: 'k', FAL_KEY: 'f', ...S3 }),
    ).not.toThrow();
  });

  it('rejects invalid values instead of guessing', () => {
    expect(() => loadConfig({ TEXT_PROVIDER: 'claude' })).toThrow(/TEXT_PROVIDER must be/);
    expect(() => loadConfig({ SITE_TIMEZONE: 'Athens' })).toThrow(/not a valid IANA time zone/);
    expect(() => loadConfig({ BUFFER_DAYS: 'two weeks' })).toThrow(/BUFFER_DAYS must be/);
  });

  it('parses pinned style anchors', () => {
    const config = loadConfig({ STYLE_ANCHOR_URLS: ' https://a.com/1.jpg, https://a.com/2.jpg ,' });
    expect(config.styleAnchorUrls).toEqual(['https://a.com/1.jpg', 'https://a.com/2.jpg']);
  });
});

describe('secrets never reach the logs', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-ant-very-secret', FAL_KEY: 'fal-very-secret', ...S3 };

  it('describeConfig contains no secret values', () => {
    const text = describeConfig(loadConfig(env)).join('\n');
    for (const secret of [env.ANTHROPIC_API_KEY, env.FAL_KEY, S3.S3_ACCESS_KEY_ID, S3.S3_SECRET_ACCESS_KEY]) {
      expect(text).not.toContain(secret);
    }
  });

  it('redactSecrets scrubs secret values from error messages', () => {
    expect(redactSecrets('401: bad key sk-ant-very-secret', env)).toBe('401: bad key [redacted]');
  });
});

describe('parseModelJson', () => {
  it('parses bare JSON', () => {
    expect(parseModelJson('{"a": 1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('strips markdown fences, with or without a language', () => {
    expect(parseModelJson('```json\n{"a": 1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseModelJson('```\n{"a": 1}\n```')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('ignores chatter around the object', () => {
    expect(parseModelJson('Here you go:\n{"a": 1}\nHope that helps!')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('fails with an instruction the model can act on', () => {
    const result = parseModelJson('I cannot do that.');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/Reply with a single JSON object and nothing else/);
  });
});
