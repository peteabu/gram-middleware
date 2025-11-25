/**
 * Logging utilities for gram-middleware
 * 
 * Requirements: 3.1, 3.2, 3.3
 */

import type { ResolvedConfig } from '../types.js';

/**
 * Formats a cost value in USD with 6 decimal places.
 * 
 * @param cost - The cost value to format
 * @returns Formatted cost string (e.g., "$0.001234")
 * 
 * Requirements: 3.3
 */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(6)}`;
}

/**
 * Formats a complete log message with model, tokens, and cost.
 * 
 * @param model - The model name
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param totalCost - Total cost in USD
 * @returns Formatted log message
 * 
 * Requirements: 3.1, 3.3
 */
export function formatLogMessage(
  model: string,
  inputTokens: number,
  outputTokens: number,
  totalCost: number
): string {
  return `[Gram] ${model} - input: ${inputTokens} tokens, output: ${outputTokens} tokens, cost: ${formatCost(totalCost)}`;
}

/**
 * Logs request completion with model, tokens, and cost.
 * Routes to custom onLog hook if provided, otherwise uses console.log.
 * 
 * @param model - The model name
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param totalCost - Total cost in USD
 * @param config - Resolved configuration with hooks
 * 
 * Requirements: 3.1, 3.2, 3.3
 */
export function logRequestCompletion(
  model: string,
  inputTokens: number,
  outputTokens: number,
  totalCost: number,
  config: ResolvedConfig
): void {
  const message = formatLogMessage(model, inputTokens, outputTokens, totalCost);
  config.hooks.onLog(message);
}
