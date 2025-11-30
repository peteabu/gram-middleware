/**
 * Base adapter interface for provider-specific SDK handling
 * 
 * Each provider adapter implements this interface to handle
 * provider-specific request shapes and parameter names.
 */

/**
 * Provider adapter interface
 * Defines methods for intercepting and modifying SDK calls
 */
export interface ProviderAdapter {
  /** Provider identifier (e.g., 'openai', 'anthropic') */
  readonly provider: string;

  /**
   * Checks if this adapter supports the given client
   * @param client - The SDK client to check
   * @returns true if this adapter can handle the client
   */
  isSupported(client: unknown): boolean;

  /**
   * Determines if a method at the given path should be intercepted
   * @param path - Array of property names (e.g., ['chat', 'completions', 'create'])
   * @returns true if this method should be intercepted
   */
  shouldIntercept(path: string[]): boolean;

  /**
   * Extracts the model identifier from request arguments
   * @param args - The request arguments object
   * @returns The model identifier string
   */
  extractModel(args: unknown): string;

  /**
   * Extracts messages from request arguments
   * @param args - The request arguments object
   * @returns Array of messages in provider-specific format
   */
  extractMessages(args: unknown): unknown[];

  /**
   * Creates a new args object with the model set to the given value
   * @param args - The original request arguments
   * @param model - The new model identifier
   * @returns New args object with updated model
   */
  setModel(args: unknown, model: string): unknown;

  /**
   * Creates a new args object with max_tokens set to the given value
   * @param args - The original request arguments
   * @param maxTokens - The max tokens value to set
   * @returns New args object with updated max_tokens
   */
  setMaxTokens(args: unknown, maxTokens: number): unknown;

  /**
   * Gets the current max_tokens value from request arguments
   * @param args - The request arguments object
   * @returns The max_tokens value or undefined if not set
   */
  getMaxTokens(args: unknown): number | undefined;

  /**
   * Checks if the request is a streaming request
   * @param args - The request arguments object
   * @returns true if this is a streaming request
   */
  isStreaming(args: unknown): boolean;

  /**
   * Extracts text content from a stream chunk
   * @param chunk - A chunk from the streaming response
   * @returns The text delta or null if no text in this chunk
   */
  extractStreamDelta(chunk: unknown): string | null;

  /**
   * Extracts token usage from a non-streaming response
   * @param response - The response object from the provider
   * @returns Usage info with prompt and completion tokens, or null if unavailable
   */
  extractUsage(response: unknown): { promptTokens: number; completionTokens: number } | null;
}
