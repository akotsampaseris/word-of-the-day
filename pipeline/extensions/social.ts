/**
 * EXTENSION POINT (not built): social auto-posting. Interface only.
 *
 * To add a network, implement SocialPoster (e.g. a Bluesky or Mastodon
 * client) and pass it to createSocialHook() in extensions/index.ts. The image
 * is the whole point of a post, so buildSocialPost() always includes it
 * along with its alt text.
 */
import type { Entry } from '../schema';
import type { PublishHook } from './types';

export interface SocialPost {
  text: string;
  link: string;
  imageUrl: string;
  imageAlt: string;
}

export interface SocialPoster {
  readonly network: string;
  post(post: SocialPost): Promise<void>;
}

export function buildSocialPost(entry: Entry, permalink: string): SocialPost {
  return {
    text: `${entry.word} (${entry.partOfSpeech}): ${entry.definition}`,
    link: permalink,
    imageUrl: entry.image.url,
    imageAlt: entry.image.alt,
  };
}

export function createSocialHook(posters: SocialPoster[]): PublishHook {
  return {
    name: 'social',
    async run(entry, { permalink, log }) {
      if (posters.length === 0) {
        log('social: no posters configured (extension point).');
        return;
      }
      const post = buildSocialPost(entry, permalink);
      for (const poster of posters) {
        await poster.post(post);
        log(`social: posted to ${poster.network}.`);
      }
    },
  };
}
