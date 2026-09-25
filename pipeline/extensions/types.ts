/**
 * EXTENSION POINT: things that happen when a day's entry goes live.
 *
 * `pnpm pipeline:announce` runs every hook in extensions/index.ts for today's
 * published entry. Run it from your deploy job, right after the daily build
 * goes live. Nothing is implemented yet; both shipped hooks are stubs.
 */
import type { Entry } from '../schema';

export interface PublishContext {
  /** Absolute URL of the entry's permalink, e.g. https://example.com/word/gongoozler/ */
  permalink: string;
  siteUrl: string;
  log: (message: string) => void;
}

export interface PublishHook {
  readonly name: string;
  run(entry: Entry, context: PublishContext): Promise<void>;
}
