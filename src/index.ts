/**
 * gram-middleware - Main entry point
 * 
 * A lightweight, drop-in wrapper for AI SDKs that adds cost awareness,
 * budget enforcement, and automatic optimization to every request.
 * 
 * Requirements: 1.1, 1.2, 1.3, 9.1, 9.2, 9.3, 9.4, 10.1, 10.8
 */

import { validateConfig, resolveConfig } from './config.js';
import { detectProvider } from './adapters/index.js';
import { safeEvaluateRequest, estimateCost } from './pipeline.js';
import { logRequestCompletion } from './utils/logging.js';
import type { ProviderAdapter } from './adapters/base.js';
import type { GramOptions, ResolvedConfig } from './types.js';

// Re-export types and errors for consumers
export type { GramOptions, GramHooks, CostEstimate, EvaluationResult, ResolvedConfig } from './types.js';
export { GramError, GramLimitError, GramDowngradeError, GramConfigError } from './errors.js';
export type { ProviderAdapter } from './adapters/base.js';

/**
 * Creates a nested proxy for SDK clients with nested structures.
 * 
 * SDK clients have nested structures (e.g., `client.chat.completions.create`).
 * This function creates recursive proxies to intercept the correct methods.
 * 
 * @param target - The target object to proxy
 * @param adapter - The provider adapter for this SDK
 * @param config - Resolved configuration
 * @param path - Current path in the object tree
 * @returns Proxied object
 * 
 * Requirements: 1.1, 1.2, 1.3
 */
function createNestedProxy<T extends object>(
  target: T,
  adapter: ProviderAdapter,
  config: ResolvedConfig,
  path: string[] = []
): T {
  return new Proxy(target, {
    get(obj, prop: string | symbol) {
      // Only handle string properties
      if (typeof prop !== 'string') {
        return Reflect.get(obj, prop);
      }

      const value = Reflect.get(obj, prop);
      const currentPath = [...path, prop];

      // If this is an intercepted method, wrap it
      if (typeof value === 'function' && adapter.shouldIntercept(currentPath)) {
        return createInterceptedMethod(value.bind(obj), adapter, config);
      }

      // If it's an object, recursively proxy it
      if (value && typeof value === 'object') {
        return createNestedProxy(value as object, adapter, config, currentPath);
      }

      // Return primitive values as-is
      return value;
    },
  });
}


/**
 * Clones arguments to avoid mutation of the original object.
 * 
 * @param args - The original arguments object
 * @returns A deep clone of the arguments
 */
function cloneArgs<T>(args: T): T {
  return structuredClone(args);
}

/**
 * Handles streaming responses for post-completion logging.
 * 
 * Wraps the async iterable to collect streamed content and log final costs
 * after the stream completes.
 * 
 * @param stream - The original streaming response
 * @param adapter - The provider adapter
 * @param config - Resolved configuration
 * @param model - The model used for the request
 * @param inputTokens - Number of input tokens
 * @param skipLogging - Whether to skip logging (e.g., after fail-safe recovery)
 * @returns Wrapped async iterable that logs on completion
 * 
 * Requirements: 9.4, 11.4
 */
async function* handleStreamingResponse(
  stream: AsyncIterable<unknown>,
  adapter: ProviderAdapter,
  config: ResolvedConfig,
  model: string,
  inputTokens: number,
  skipLogging: boolean
): AsyncIterable<unknown> {
  let concatenatedContent = '';

  for await (const chunk of stream) {
    // Extract text delta from provider-specific chunk format
    const delta = adapter.extractStreamDelta(chunk);
    if (delta) {
      concatenatedContent += delta;
    }
    yield chunk;
  }

  // After stream ends, log final cost with actual output tokens
  if (!skipLogging) {
    try {
      const outputTokens = await config.gram.countTokens(concatenatedContent, model);
      // Calculate total cost: input cost + output cost
      const estimate = await estimateCost([], model, config);
      if (estimate) {
        // outputCost in estimate is price per 1M tokens
        const outputCost = (outputTokens * estimate.outputCost) / 1_000_000;
        const inputCost = (inputTokens * estimate.inputCost) / inputTokens; // Already calculated
        const totalCost = inputCost + outputCost;
        logRequestCompletion(model, inputTokens, outputTokens, totalCost, config);
      }
    } catch {
      // Silently ignore logging errors for streaming
    }
  }
}

/**
 * Creates an intercepted method wrapper that runs the evaluation pipeline.
 * 
 * @param originalMethod - The original SDK method to wrap
 * @param adapter - The provider adapter
 * @param config - Resolved configuration
 * @returns Wrapped method that evaluates requests before execution
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */
function createInterceptedMethod(
  originalMethod: (...args: unknown[]) => unknown,
  adapter: ProviderAdapter,
  config: ResolvedConfig
): (...args: unknown[]) => unknown {
  return async function interceptedMethod(...args: unknown[]): Promise<unknown> {
    // Get the first argument (request options)
    const originalArgs = args[0];
    
    // Clone args to avoid mutation
    let workingArgs = cloneArgs(originalArgs);

    // Extract model and messages from the request
    const model = adapter.extractModel(workingArgs);
    const messages = adapter.extractMessages(workingArgs);

    // Run the evaluation pipeline
    const result = await safeEvaluateRequest(
      messages,
      model,
      adapter.provider,
      config,
      workingArgs,
      (a, m) => adapter.setModel(a, m),
      (a) => adapter.getMaxTokens(a),
      (a, t) => adapter.setMaxTokens(a, t)
    );

    // If evaluation blocked the request, throw the error
    if (!result.proceed && result.error) {
      throw result.error;
    }

    // Use modified args if provided
    if (result.modifiedArgs !== undefined) {
      workingArgs = result.modifiedArgs;
    }

    // Execute the original method with (potentially modified) arguments
    const response = await originalMethod(workingArgs);

    // Handle streaming responses
    if (adapter.isStreaming(workingArgs)) {
      // Get input tokens for logging
      const estimate = await estimateCost(messages, result.downgraded?.to ?? model, config);
      const inputTokens = estimate?.tokens ?? 0;
      
      // Return wrapped stream that logs on completion
      return handleStreamingResponse(
        response as AsyncIterable<unknown>,
        adapter,
        config,
        result.downgraded?.to ?? model,
        inputTokens,
        result.failedOpen ?? false
      );
    }

    // For non-streaming responses, log completion
    if (!result.failedOpen) {
      const estimate = await estimateCost(messages, result.downgraded?.to ?? model, config);
      if (estimate) {
        // Extract actual token usage from response
        const usage = adapter.extractUsage(response);
        const outputTokens = usage?.completionTokens ?? 0;
        const inputTokens = usage?.promptTokens ?? estimate.tokens;

        // Calculate total cost with actual output tokens
        const outputCost = (outputTokens * estimate.outputCost) / 1_000_000;
        const totalCost = estimate.inputCost + outputCost;
        logRequestCompletion(result.downgraded?.to ?? model, inputTokens, outputTokens, totalCost, config);
      }
    }

    // Return the response unchanged (Requirement 9.2)
    return response;
  };
}


/**
 * Wraps an AI SDK client with cost awareness and budget enforcement.
 * 
 * This is the main entry point for gram-middleware. It returns a wrapped client
 * that maintains the original SDK's interface while adding cost controls.
 * 
 * @param client - The AI SDK client to wrap (OpenAI, Anthropic, etc.)
 * @param options - Configuration options for cost controls
 * @returns Wrapped client with the same interface as the original
 * @throws GramConfigError if configuration is invalid or SDK is unsupported
 * 
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * import { withGram } from 'gram-middleware';
 * 
 * const openai = withGram(new OpenAI(), {
 *   maxCost: 0.10,
 *   autoDowngrade: true,
 *   fallbackModels: ['gpt-4o-mini', 'gpt-3.5-turbo'],
 * });
 * 
 * // Use exactly like the original client
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4o',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * ```
 * 
 * Requirements: 1.1, 10.1, 10.8
 */
export function withGram<T extends object>(client: T, options?: GramOptions): T {
  // Step 1: Validate configuration (throws GramConfigError for invalid values)
  validateConfig(options);

  // Step 2: Resolve configuration with defaults
  const config = resolveConfig(options);

  // Step 3: Detect provider and get adapter (throws GramConfigError if unsupported)
  const adapter = detectProvider(client);

  // Step 4: Log warning if autoDowngrade is enabled but no fallbackModels (Requirement 10.8)
  if (options?.autoDowngrade && (!options.fallbackModels || options.fallbackModels.length === 0)) {
    config.hooks.onLog('[Gram] Warning: autoDowngrade is enabled but no fallbackModels configured');
  }

  // Step 5: Return proxied client
  return createNestedProxy(client, adapter, config);
}
