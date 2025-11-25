/**
 * Configuration validation and resolution for gram-middleware
 */

import { Gram } from 'gram-library';
import { GramConfigError } from './errors.js';
import type { GramOptions, GramHooks, ResolvedConfig } from './types.js';

/**
 * Validates configuration options and throws GramConfigError for invalid values.
 * 
 * @param options - The configuration options to validate
 * @throws GramConfigError if any configuration value is invalid
 * 
 * Requirements: 10.5, 10.6, 10.7
 */
export function validateConfig(options?: GramOptions): void {
  if (options?.maxCost !== undefined && options.maxCost <= 0) {
    throw new GramConfigError('maxCost', 'Must be a positive number');
  }

  if (options?.remainingBudget !== undefined && options.remainingBudget < 0) {
    throw new GramConfigError('remainingBudget', 'Cannot be negative');
  }

  if (options?.minOutputTokens !== undefined && options.minOutputTokens <= 0) {
    throw new GramConfigError('minOutputTokens', 'Must be a positive number');
  }
}

/**
 * Resolves configuration options with defaults applied.
 * 
 * Defaults:
 * - failOpen: true
 * - minOutputTokens: 500
 * - strict: true if maxCost is provided, false otherwise
 * - gram: new Gram() instance if not provided
 * - hooks: no-op functions for undefined hooks
 * 
 * @param options - The configuration options to resolve
 * @returns Fully resolved configuration with all defaults applied
 * 
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */
export function resolveConfig(options?: GramOptions): ResolvedConfig {
  const hasMaxCost = options?.maxCost !== undefined;

  // Create no-op hooks for undefined hooks
  const noOpHooks: Required<GramHooks> = {
    onLimitExceeded: () => {},
    onDowngrade: () => {},
    onOutputCapped: () => {},
    onLog: (msg: string) => console.log(msg),
  };

  return {
    gram: options?.gram ?? new Gram(),
    maxCost: options?.maxCost ?? null,
    autoDowngrade: options?.autoDowngrade ?? false,
    fallbackModels: options?.fallbackModels ?? [],
    remainingBudget: options?.remainingBudget ?? null,
    minOutputTokens: options?.minOutputTokens ?? 500,
    strict: options?.strict ?? hasMaxCost,
    failOpen: options?.failOpen ?? true,
    hooks: {
      onLimitExceeded: options?.hooks?.onLimitExceeded ?? noOpHooks.onLimitExceeded,
      onDowngrade: options?.hooks?.onDowngrade ?? noOpHooks.onDowngrade,
      onOutputCapped: options?.hooks?.onOutputCapped ?? noOpHooks.onOutputCapped,
      onLog: options?.hooks?.onLog ?? noOpHooks.onLog,
    },
  };
}
