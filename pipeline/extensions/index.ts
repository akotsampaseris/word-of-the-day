/**
 * The hooks `pnpm pipeline:announce` runs, in order. Add new ones here.
 */
import { createButtondownHook } from './newsletter-buttondown';
import { createSocialHook } from './social';
import type { PublishHook } from './types';

export function createPublishHooks(): PublishHook[] {
  return [createButtondownHook(), createSocialHook([])];
}
