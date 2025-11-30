/**
 * OpenAI SDK adapter
 * 
 * Handles OpenAI-specific request shapes and parameter extraction.
 */

import type { ProviderAdapter } from './base.js';

/** OpenAI chat completion request arguments */
interface OpenAIArgs {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  stream?: boolean;
}

/** OpenAI message format */
interface OpenAIMessage {
  role: string;
  content: string | null;
}

/** OpenAI stream chunk format */
interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
}

/** OpenAI response format */
interface OpenAIResponse {
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI adapter implementation
 * Intercepts chat.completions.create calls
 */
export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = 'openai';

  /**
   * Detects OpenAI client by checking for chat.completions property
   */
  isSupported(client: unknown): boolean {
    if (!client || typeof client !== 'object') {
      return false;
    }
    const c = client as Record<string, unknown>;
    return (
      'chat' in c &&
      c.chat !== null &&
      typeof c.chat === 'object' &&
      'completions' in (c.chat as Record<string, unknown>)
    );
  }

  /**
   * Intercepts ['chat', 'completions', 'create'] path
   */
  shouldIntercept(path: string[]): boolean {
    return (
      path.length === 3 &&
      path[0] === 'chat' &&
      path[1] === 'completions' &&
      path[2] === 'create'
    );
  }

  /**
   * Extracts model from args.model
   */
  extractModel(args: unknown): string {
    const a = args as OpenAIArgs;
    return a.model;
  }

  /**
   * Extracts messages from args.messages
   */
  extractMessages(args: unknown): unknown[] {
    const a = args as OpenAIArgs;
    return a.messages;
  }

  /**
   * Sets model in args, returning a new object
   */
  setModel(args: unknown, model: string): unknown {
    return {
      ...(args as object),
      model,
    };
  }

  /**
   * Sets max_tokens in args, returning a new object
   */
  setMaxTokens(args: unknown, maxTokens: number): unknown {
    return {
      ...(args as object),
      max_tokens: maxTokens,
    };
  }

  /**
   * Gets max_tokens from args
   */
  getMaxTokens(args: unknown): number | undefined {
    const a = args as OpenAIArgs;
    return a.max_tokens;
  }

  /**
   * Checks if stream is enabled
   */
  isStreaming(args: unknown): boolean {
    const a = args as OpenAIArgs;
    return a.stream === true;
  }

  /**
   * Extracts text delta from choices[0].delta.content
   */
  extractStreamDelta(chunk: unknown): string | null {
    const c = chunk as OpenAIStreamChunk;
    const content = c.choices?.[0]?.delta?.content;
    return content ?? null;
  }

  /**
   * Extracts token usage from response.usage
   */
  extractUsage(response: unknown): { promptTokens: number; completionTokens: number } | null {
    const r = response as OpenAIResponse;
    if (!r.usage) {
      return null;
    }
    return {
      promptTokens: r.usage.prompt_tokens,
      completionTokens: r.usage.completion_tokens,
    };
  }
}
