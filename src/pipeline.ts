/**
 * Evaluation pipeline for gram-middleware
 * 
 * Handles cost estimation, limit evaluation, auto-downgrade, output capping, and request processing.
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 8.1, 8.2, 8.3, 8.4
 */

import { GramLimitError, GramDowngradeError } from './errors.js';
import { safeInvokeHook } from './utils/hooks.js';
import { isModelForProvider } from './adapters/index.js';
import { calculateMaxAffordableOutputTokens } from './utils/cost.js';
import type { CostEstimate, EvaluationResult, ResolvedConfig } from './types.js';

/**
 * Estimates the cost of a request using gram-library.
 * 
 * @param messages - The messages to estimate cost for
 * @param model - The model identifier
 * @param config - Resolved configuration
 * @returns CostEstimate or null if estimation fails and failOpen is true
 * @throws Error if estimation fails and failOpen is false
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */
export async function estimateCost(
  messages: unknown[],
  model: string,
  config: ResolvedConfig
): Promise<CostEstimate | null> {
  try {
    const estimate = await config.gram.estimate(messages, model);
    return {
      tokens: estimate.tokens,
      inputCost: estimate.inputCost,
      outputCost: estimate.outputCost,
    };
  } catch (error) {
    if (config.failOpen) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      config.hooks.onLog(`[Gram] Warning: Cost estimation failed for model ${model}: ${errorMessage}`);
      return null;
    }
    throw error;
  }
}

/**
 * Evaluates whether a request should proceed based on maxCost limit.
 * 
 * @param estimate - The cost estimate for the request
 * @param model - The model identifier
 * @param config - Resolved configuration
 * @returns EvaluationResult indicating whether to proceed or block
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
export function evaluateMaxCost<TArgs = unknown>(
  estimate: CostEstimate | null,
  model: string,
  config: ResolvedConfig,
  args?: TArgs
): EvaluationResult<TArgs> {
  // If no maxCost configured, proceed without evaluation (Requirement 4.3)
  if (config.maxCost === null) {
    return { proceed: true, modifiedArgs: args };
  }

  // If estimation failed (null), proceed based on failOpen (already handled in estimateCost)
  if (estimate === null) {
    return { proceed: true, modifiedArgs: args };
  }

  // Compare estimated inputCost against maxCost
  if (estimate.inputCost > config.maxCost) {
    if (config.strict) {
      // Requirement 4.1, 4.4: Throw GramLimitError in strict mode
      return {
        proceed: false,
        error: new GramLimitError(estimate.inputCost, config.maxCost, model),
      };
    } else {
      // Requirement 4.2: Invoke onLimitExceeded hook and proceed in lenient mode
      config.hooks.onLimitExceeded(estimate);
      return { proceed: true, modifiedArgs: args };
    }
  }

  // Under limit, proceed
  return { proceed: true, modifiedArgs: args };
}

/**
 * Result of attempting to find a fallback model
 */
export interface FallbackResult {
  found: boolean;
  model?: string;
  estimate?: CostEstimate;
  attemptedModels: string[];
}

/**
 * Filters fallback models to only include models from the same provider.
 * 
 * @param fallbackModels - List of fallback model identifiers
 * @param provider - The provider name to filter by
 * @param config - Resolved configuration
 * @returns Filtered list of fallback models for the same provider
 * 
 * Requirements: 5.8
 */
export function filterFallbacksByProvider(
  fallbackModels: string[],
  provider: string,
  config: ResolvedConfig
): string[] {
  return fallbackModels.filter((model) => isModelForProvider(model, provider, config.gram));
}

/**
 * Iterates through fallback models to find one that fits within maxCost.
 * 
 * @param messages - The messages to estimate cost for
 * @param fallbackModels - List of fallback model identifiers (already filtered by provider)
 * @param maxCost - Maximum allowed cost
 * @param config - Resolved configuration
 * @returns FallbackResult with the first model that fits, or all attempted models if none fit
 * 
 * Requirements: 5.1, 5.2, 5.3
 */
export async function findAffordableFallback(
  messages: unknown[],
  fallbackModels: string[],
  maxCost: number,
  config: ResolvedConfig
): Promise<FallbackResult> {
  const attemptedModels: string[] = [];

  for (const fallbackModel of fallbackModels) {
    attemptedModels.push(fallbackModel);
    
    const estimate = await estimateCost(messages, fallbackModel, config);
    
    // If estimation failed, skip this model
    if (estimate === null) {
      continue;
    }
    
    // Check if this model fits within maxCost
    if (estimate.inputCost <= maxCost) {
      return {
        found: true,
        model: fallbackModel,
        estimate,
        attemptedModels,
      };
    }
  }

  return {
    found: false,
    attemptedModels,
  };
}

/**
 * Attempts to auto-downgrade to a cheaper model when the original exceeds maxCost.
 * 
 * @param messages - The messages to estimate cost for
 * @param originalModel - The original model identifier
 * @param originalEstimate - The cost estimate for the original model
 * @param provider - The provider name for filtering fallbacks
 * @param config - Resolved configuration
 * @param args - The original request arguments
 * @param setModel - Function to set the model in args
 * @returns EvaluationResult with downgrade info or error
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
 */
export async function attemptAutoDowngrade<TArgs = unknown>(
  messages: unknown[],
  originalModel: string,
  originalEstimate: CostEstimate,
  provider: string,
  config: ResolvedConfig,
  args: TArgs,
  setModel: (args: TArgs, model: string) => TArgs
): Promise<EvaluationResult<TArgs>> {
  // Skip if autoDowngrade is not enabled or no fallbackModels configured (Requirement 5.7)
  if (!config.autoDowngrade || config.fallbackModels.length === 0) {
    // Fall through to strict mode evaluation
    if (config.strict) {
      return {
        proceed: false,
        error: new GramLimitError(originalEstimate.inputCost, config.maxCost!, originalModel),
      };
    } else {
      config.hooks.onLimitExceeded(originalEstimate);
      return { proceed: true, modifiedArgs: args };
    }
  }

  // Filter fallback models to same provider only (Requirement 5.8)
  const providerFallbacks = filterFallbacksByProvider(config.fallbackModels, provider, config);

  // If no fallbacks for this provider, skip downgrade logic
  if (providerFallbacks.length === 0) {
    if (config.strict) {
      return {
        proceed: false,
        error: new GramLimitError(originalEstimate.inputCost, config.maxCost!, originalModel),
      };
    } else {
      config.hooks.onLimitExceeded(originalEstimate);
      return { proceed: true, modifiedArgs: args };
    }
  }

  // Find an affordable fallback (Requirements 5.1, 5.2, 5.3)
  const fallbackResult = await findAffordableFallback(
    messages,
    providerFallbacks,
    config.maxCost!,
    config
  );

  if (fallbackResult.found && fallbackResult.model && fallbackResult.estimate) {
    // Successful downgrade (Requirements 5.3, 5.4)
    const savings = originalEstimate.inputCost - fallbackResult.estimate.inputCost;
    
    // Modify args with new model
    const modifiedArgs = setModel(args, fallbackResult.model);
    
    // Invoke onDowngrade hook
    config.hooks.onDowngrade(originalModel, fallbackResult.model, savings);
    
    return {
      proceed: true,
      modifiedArgs,
      downgraded: {
        from: originalModel,
        to: fallbackResult.model,
        savings,
      },
    };
  }

  // All fallbacks exhausted (Requirements 5.5, 5.6)
  if (config.strict) {
    return {
      proceed: false,
      error: new GramDowngradeError(
        originalModel,
        fallbackResult.attemptedModels,
        'All fallback models exceed cost limit'
      ),
    };
  } else {
    config.hooks.onLimitExceeded(originalEstimate);
    return { proceed: true, modifiedArgs: args };
  }
}

/**
 * Full evaluation pipeline that combines cost estimation, limit evaluation, and auto-downgrade.
 * 
 * @param messages - The messages to estimate cost for
 * @param model - The model identifier
 * @param provider - The provider name
 * @param config - Resolved configuration
 * @param args - The original request arguments
 * @param setModel - Function to set the model in args
 * @returns EvaluationResult indicating whether to proceed, block, or downgrade
 * 
 * Requirements: 2.1, 4.1, 4.2, 4.3, 5.1-5.8
 */
export async function evaluateRequest<TArgs = unknown>(
  messages: unknown[],
  model: string,
  provider: string,
  config: ResolvedConfig,
  args: TArgs,
  setModel: (args: TArgs, model: string) => TArgs
): Promise<EvaluationResult<TArgs>> {
  // Step 1: Estimate cost
  const estimate = await estimateCost(messages, model, config);
  
  // If estimation failed and we're proceeding (failOpen), return early
  if (estimate === null) {
    return { proceed: true, modifiedArgs: args };
  }

  // Step 2: Check if under limit or no limit configured
  if (config.maxCost === null || estimate.inputCost <= config.maxCost) {
    return { proceed: true, modifiedArgs: args };
  }

  // Step 3: Over limit - attempt auto-downgrade if enabled
  return attemptAutoDowngrade(
    messages,
    model,
    estimate,
    provider,
    config,
    args,
    setModel
  );
}


/**
 * Result of output cap evaluation
 */
export interface OutputCapResult {
  shouldCap: boolean;
  maxTokens?: number;
  reason?: string;
}

/**
 * Evaluates whether output capping should be applied based on remaining budget.
 * 
 * @param estimate - The cost estimate for the request
 * @param model - The model identifier
 * @param config - Resolved configuration
 * @param currentMaxTokens - The current max_tokens value from the request (if any)
 * @returns OutputCapResult indicating whether to cap and the calculated max tokens
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */
export function evaluateOutputCap(
  estimate: CostEstimate | null,
  _model: string,
  config: ResolvedConfig,
  currentMaxTokens?: number
): OutputCapResult {
  // Skip if remainingBudget not configured (Requirement 6.5)
  if (config.remainingBudget === null) {
    return { shouldCap: false };
  }

  // If estimation failed, skip capping
  if (estimate === null) {
    return { shouldCap: false };
  }

  // Get output price from gram-library
  // outputCost in estimate is the rate reference (price per 1M tokens)
  const outputPrice = estimate.outputCost;
  
  // Calculate max affordable output tokens (Requirement 6.1)
  const calculatedMaxTokens = calculateMaxAffordableOutputTokens(
    config.remainingBudget,
    estimate.inputCost,
    outputPrice
  );

  // Handle zero or negative result (Requirement 6.6)
  if (calculatedMaxTokens <= 0) {
    if (config.strict) {
      // Block the request in strict mode
      return {
        shouldCap: true,
        maxTokens: 0,
        reason: 'Insufficient budget for any output tokens',
      };
    }
    // In lenient mode, don't cap (let it proceed)
    return { shouldCap: false };
  }

  // Check against minOutputTokens threshold (Requirements 6.2, 6.3)
  if (calculatedMaxTokens >= config.minOutputTokens) {
    // Above threshold, don't modify max_tokens
    return { shouldCap: false };
  }

  // Below threshold, apply capping
  // If developer also specified max_tokens, use the minimum (Requirement 6.7)
  let finalMaxTokens = calculatedMaxTokens;
  if (currentMaxTokens !== undefined && currentMaxTokens > 0) {
    finalMaxTokens = Math.min(calculatedMaxTokens, currentMaxTokens);
  }

  return {
    shouldCap: true,
    maxTokens: finalMaxTokens,
    reason: `Budget constraint: ${calculatedMaxTokens} tokens affordable (threshold: ${config.minOutputTokens})`,
  };
}

/**
 * Applies output capping to the request arguments if needed.
 * 
 * @param estimate - The cost estimate for the request
 * @param model - The model identifier
 * @param config - Resolved configuration
 * @param args - The request arguments
 * @param getMaxTokens - Function to get current max_tokens from args
 * @param setMaxTokens - Function to set max_tokens in args
 * @returns Updated EvaluationResult with output capping info
 * 
 * Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */
export function applyOutputCap<TArgs = unknown>(
  estimate: CostEstimate | null,
  _model: string,
  config: ResolvedConfig,
  args: TArgs,
  getMaxTokens: (args: TArgs) => number | undefined,
  setMaxTokens: (args: TArgs, maxTokens: number) => TArgs
): { args: TArgs; outputCapped?: { maxTokens: number; reason: string } } {
  const currentMaxTokens = getMaxTokens(args);
  const capResult = evaluateOutputCap(estimate, _model, config, currentMaxTokens);

  if (!capResult.shouldCap || capResult.maxTokens === undefined) {
    return { args };
  }

  // Apply the cap
  const modifiedArgs = setMaxTokens(args, capResult.maxTokens);
  
  // Invoke onOutputCapped hook (Requirement 6.4)
  config.hooks.onOutputCapped(capResult.maxTokens, capResult.reason!);

  return {
    args: modifiedArgs,
    outputCapped: {
      maxTokens: capResult.maxTokens,
      reason: capResult.reason!,
    },
  };
}

/**
 * Result of safe pipeline execution
 */
export interface SafeExecutionResult<TArgs = unknown> {
  proceed: boolean;
  modifiedArgs?: TArgs;
  error?: Error;
  downgraded?: { from: string; to: string; savings: number };
  outputCapped?: { maxTokens: number; reason: string };
  /** Indicates if the result was due to fail-safe recovery */
  failedOpen?: boolean;
}

/**
 * Safely executes the evaluation pipeline with fail-safe error handling.
 * 
 * When failOpen is true (default):
 * - Any error during pipeline execution is caught and logged
 * - The original request proceeds unchanged
 * - Cost logging is skipped for recovered requests
 * 
 * When failOpen is false:
 * - Errors are propagated to the caller
 * 
 * @param messages - The messages to estimate cost for
 * @param model - The model identifier
 * @param provider - The provider name
 * @param config - Resolved configuration
 * @param args - The original request arguments
 * @param setModel - Function to set the model in args
 * @param getMaxTokens - Function to get current max_tokens from args
 * @param setMaxTokens - Function to set max_tokens in args
 * @returns SafeExecutionResult indicating whether to proceed, block, or downgrade
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */
export async function safeEvaluateRequest<TArgs = unknown>(
  messages: unknown[],
  model: string,
  provider: string,
  config: ResolvedConfig,
  args: TArgs,
  setModel: (args: TArgs, model: string) => TArgs,
  getMaxTokens?: (args: TArgs) => number | undefined,
  setMaxTokens?: (args: TArgs, maxTokens: number) => TArgs
): Promise<SafeExecutionResult<TArgs>> {
  try {
    // Step 1: Run the main evaluation pipeline
    const evalResult = await evaluateRequest(messages, model, provider, config, args, setModel);
    
    // If evaluation blocked the request, return early
    if (!evalResult.proceed) {
      return evalResult;
    }
    
    // Step 2: Apply output capping if configured and functions provided
    let finalArgs = evalResult.modifiedArgs ?? args;
    let outputCapped = evalResult.outputCapped;
    
    if (getMaxTokens && setMaxTokens && config.remainingBudget !== null) {
      // Get the estimate for output capping
      const estimate = await estimateCost(messages, evalResult.downgraded?.to ?? model, config);
      const capResult = applyOutputCap(estimate, model, config, finalArgs, getMaxTokens, setMaxTokens);
      finalArgs = capResult.args;
      if (capResult.outputCapped) {
        outputCapped = capResult.outputCapped;
      }
    }
    
    return {
      proceed: true,
      modifiedArgs: finalArgs,
      downgraded: evalResult.downgraded,
      outputCapped,
    };
  } catch (error) {
    // Handle errors based on failOpen configuration
    if (config.failOpen) {
      // Requirement 8.1, 8.3: Log error and proceed with original request
      const errorMessage = error instanceof Error ? error.message : String(error);
      safeInvokeHook(config.hooks.onLog, `[Gram] Error during evaluation, proceeding with original request: ${errorMessage}`);
      
      // Requirement 8.4: Skip cost logging on failure recovery (indicated by failedOpen flag)
      return {
        proceed: true,
        modifiedArgs: args,
        failedOpen: true,
      };
    } else {
      // Requirement 8.2: Propagate error when failOpen is false
      throw error;
    }
  }
}
