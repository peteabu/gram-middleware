/**
 * Error classes for gram-middleware
 */

/**
 * Base error class for all gram-middleware errors
 */
export class GramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GramError';
    // Maintains proper stack trace for where error was thrown (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when a request is blocked due to cost limits
 * Contains estimatedCost, maxCost, and model for programmatic handling
 */
export class GramLimitError extends GramError {
  readonly estimatedCost: number;
  readonly maxCost: number;
  readonly model: string;

  constructor(estimatedCost: number, maxCost: number, model: string) {
    // Safely format numbers to avoid errors if undefined/null is passed
    const estCostStr = typeof estimatedCost === 'number' ? estimatedCost.toFixed(6) : String(estimatedCost);
    const maxCostStr = typeof maxCost === 'number' ? maxCost.toFixed(6) : String(maxCost);
    super(
      `Request blocked. Estimated cost $${estCostStr} exceeds limit $${maxCostStr} for model ${model}`
    );
    this.name = 'GramLimitError';
    this.estimatedCost = estimatedCost;
    this.maxCost = maxCost;
    this.model = model;
  }
}

/**
 * Error thrown when auto-downgrade exhausts all fallback models
 * Contains originalModel, attemptedFallbacks array, and reason
 */
export class GramDowngradeError extends GramError {
  readonly originalModel: string;
  readonly attemptedFallbacks: string[];
  readonly reason: string;

  constructor(originalModel: string, attemptedFallbacks: string[], reason: string) {
    super(
      `Auto-downgrade failed. Original: ${originalModel}, Attempted: [${attemptedFallbacks.join(', ')}]. ${reason}`
    );
    this.name = 'GramDowngradeError';
    this.originalModel = originalModel;
    this.attemptedFallbacks = attemptedFallbacks;
    this.reason = reason;
  }
}

/**
 * Error thrown when configuration is invalid
 * Contains field and reason for the validation failure
 */
export class GramConfigError extends GramError {
  readonly field: string;
  readonly reason: string;

  constructor(field: string, reason: string) {
    super(`Invalid configuration for '${field}': ${reason}`);
    this.name = 'GramConfigError';
    this.field = field;
    this.reason = reason;
  }
}
