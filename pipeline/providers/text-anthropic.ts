/**
 * Claude via the Anthropic Messages API. Default model: claude-haiku-4-5
 * (set TEXT_MODEL to change it).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { TextProvider } from './types';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  /** Injectable for tests. */
  client?: Anthropic;
}

export function createAnthropicTextProvider(options: AnthropicOptions): TextProvider {
  // The SDK retries rate limits and 5xx errors itself.
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 3 });

  return {
    name: 'anthropic',
    model: options.model,
    async complete(request) {
      const message = await client.messages.create({
        model: options.model,
        // An entry is roughly 600 tokens of JSON; this leaves plenty of room.
        max_tokens: options.maxTokens ?? 2000,
        system: request.system,
        messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
      });
      // If the reply was cut off (stop_reason "max_tokens") it simply fails
      // JSON parsing and goes through the normal repair loop.
      return message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    },
  };
}
