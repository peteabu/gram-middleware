/**
 * Adapter registry for provider detection and utilities
 */

import type { Gram } from 'gram-library';
import type { ProviderAdapter } from './base.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { GramConfigError } from '../errors.js';

// Re-export types and adapters
export type { ProviderAdapter } from './base.js';
export { OpenAIAdapter } from './openai.js';
export { AnthropicAdapter } from './anthropic.js';

/**
 * Registry of all supported provider adapters
 */
const adapters: ProviderAdapter[] = [new OpenAIAdapter(), new AnthropicAdapter()];

/**
 * Detects the provider for a given SDK client
 * @param client - The SDK client to detect
 * @returns The appropriate provider adapter
 * @throws GramConfigError if the SDK is not supported
 */
export function detectProvider(client: unknown): ProviderAdapter {
  for (const adapter of adapters) {
    if (adapter.isSupported(client)) {
      return adapter;
    }
  }
  throw new GramConfigError('client', 'Unsupported SDK. Supported: OpenAI, Anthropic');
}

/**
 * Checks if a model belongs to a specific provider
 * @param model - The model identifier to check
 * @param provider - The provider name to match
 * @param gram - The Gram instance for model lookup
 * @returns true if the model belongs to the provider
 */
export function isModelForProvider(model: string, provider: string, gram: Gram): boolean {
  const modelData = gram.getModel(model);
  if (!modelData) {
    return false;
  }
  return modelData.provider === provider;
}
