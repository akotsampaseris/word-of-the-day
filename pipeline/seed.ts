/**
 * Small deterministic helpers. The same (date, slug) always produces the same
 * seed, so mock output is reproducible and real image providers that accept a
 * seed can be re-run to get the same picture.
 */
import { createHash } from 'node:crypto';

/** FNV-1a: a tiny, well-known string hash. Returns an unsigned 32-bit integer. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function seedFor(date: string, slug: string): number {
  return hashString(`${date}:${slug}`);
}

/** Picks an item from a list using the seed, so the choice is stable. */
export function pick<T>(items: readonly T[], seed: number): T {
  if (items.length === 0) throw new Error('pick() needs at least one item');
  return items[seed % items.length]!;
}

/** First 10 hex characters of the SHA-256 of some bytes. Used in image filenames. */
export function shortHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 10);
}
