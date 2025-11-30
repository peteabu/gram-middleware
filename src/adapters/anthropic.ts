/**
 * Anthropic SDK adapter
 * 
 * Handles Anthropic-specific request shapes and parameter extraction.
 */

import type { ProviderAdapter } from './base.js';

/** Anthropic message request arguments */
interface AnthropicArgs {
  model: string;
  messages: AnthropicMessage[];
  max_tokens?: number;
  stream?: boolean;
}

/** Anthropic message format */
interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

/** Anthropic content block format */
interface AnthropicContentBlock {
  type: string;
  text?: string;
}

/** Anthropic stream event format */
interface AnthropicStreamEvent {
  type?: string;
  delta?: {
    type?: string;
    text?: string;
  };
}

/** Anthropic response format */
interface AnthropicResponse {
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Anthropic adapter implementation
 * Intercepts messages.create calls
 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = 'anthropic';

  /**
   * Detects Anthropic client by checking for messages property
   */
  isSupported(client: unknown): boolean {
    if (!client || typeof client !== 'object') {
      return false;
    }
    const c = client as Record<string, unknown>;
    return 'messages' in c && c.messages !== null && typeof c.messages === 'object';
  }

  /**
   * Intercepts ['messages', 'create'] path
   */
  shouldIntercept(path: string[]): boolean {
    return path.length === 2 && path[0] === 'messages' && path[1] === 'create';
  }

  /**
   * Extracts model from args.model
   */
  extractModel(args: unknown): string {
    const a = args as AnthropicArgs;
    return a.model;
  }

  /**
   * Extracts messages from args.messages
   * Handles both string content and content arrays
   */
  extractMessages(args: unknown): unknown[] {
    const a = args as AnthropicArgs;
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
    const a = args as AnthropicArgs;
    return a.max_tokens;
  }

  /**
   * Checks if stream is enabled
   */
  isStreaming(args: unknown): boolean {
    const a = args as AnthropicArgs;
    return a.stream === true;
  }

  /**
   * Extracts text delta from content_block_delta events
   */
  extractStreamDelta(chunk: unknown): string | null {
    const event = chunk as AnthropicStreamEvent;
    // Anthropic uses content_block_delta events for text streaming
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      return event.delta.text ?? null;
    }
    return null;
  }

  /**
   * Extracts token usage from response.usage
   */
  extractUsage(response: unknown): { promptTokens: number; completionTokens: number } | null {
    const r = response as AnthropicResponse;
    if (!r.usage) {
      return null;
    }
    return {
      promptTokens: r.usage.input_tokens,
      completionTokens: r.usage.output_tokens,
    };
  }
}
