/**
 * EXTENSION POINT (not built): email the day's word via Buttondown.
 *
 * Out of scope for the MVP. Subscriptions will be handled entirely by
 * Buttondown, so all this hook needs to do is one authenticated POST when an
 * entry goes live. To finish it:
 *   1. Add BUTTONDOWN_API_KEY to .env, .env.example, the README table, and
 *      SECRET_ENV_VARS in pipeline/config.ts (so it is redacted from logs).
 *   2. Replace the body of run() with a fetch() POST to Buttondown's
 *      "create email" endpoint (check their current API docs), using
 *      entry.word as the subject and the definition, image and permalink as
 *      the body.
 *   3. Decide how to avoid double-sends if announce runs twice in a day
 *      (for example, look for an existing email with the same subject first).
 */
import type { PublishHook } from './types';

export function createButtondownHook(): PublishHook {
  return {
    name: 'newsletter (Buttondown)',
    async run(entry, { log }) {
      log(`newsletter: not implemented (extension point). Would send "${entry.word}".`);
    },
  };
}
