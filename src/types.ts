/**
 * Core type definitions for gram-middleware
 */

import type { Gram } from 'gram-library';

/**
 * Cost estimate from gram-library
 */
export interface CostEstimate {
  tokens: number;
  inputCost: number;
  outputCost: number; // Rate reference, not actual output cost
}

/**
 * Event hooks for middleware events
 */
export interface GramHooks {
  onLimitExceeded?: (estimate: CostEstimate) => void;
  onDowngrade?: (originalModel: string, newModel: string, savings: number) => void;
  onOutputCapped?: (maxTokens: number, reason: string) => void;
  onLog?: (message: string) => void;
}

/**
 * Configuration options for withGram()
 */
export interface GramOptions {
  gram?: Gram;
  maxCost?: number;
  autoDowngrade?: boolean;
  fallbackModels?: string[];
  remainingBudget?: number;
  minOutputTokens?: number;
  strict?: boolean;
  failOpen?: boolean;
  hooks?: GramHooks;
}

/**
 * Internal evaluation result (generic for type safety)
 */
export interface EvaluationResult<TArgs = unknown> {
  proceed: boolean;
  modifiedArgs?: TArgs;
  error?: Error;
  downgraded?: { from: string; to: string; savings: number };
  outputCapped?: { maxTokens: number; reason: string };
}

/**
 * Resolved configuration with all defaults applied
 */
export interface ResolvedConfig {
  gram: Gram;
  maxCost: number | null;
  autoDowngrade: boolean;
  fallbackModels: string[];
  remainingBudget: number | null;
  minOutputTokens: number;
  strict: boolean;
  failOpen: boolean;
  hooks: Required<GramHooks>;
}
