/**
 * OpenAI via the Responses API. Selected with TEXT_PROVIDER=openai.
 */
import OpenAI from 'openai';
import type { TextProvider } from './types';

export interface OpenAITextOptions {
  apiKey: string;
  model: string;
  /** Injectable for tests. */
  client?: OpenAI;
}

export function createOpenAITextProvider(options: OpenAITextOptions): TextProvider {
  const client = options.client ?? new OpenAI({ apiKey: options.apiKey, maxRetries: 3 });

  return {
    name: 'openai',
    model: options.model,
    async complete(request) {
      const response = await client.responses.create({
        model: options.model,
        instructions: request.system,
        input: request.messages.map((message) => ({ role: message.role, content: message.content })),
      });
      return response.output_text;
    },
  };
}
