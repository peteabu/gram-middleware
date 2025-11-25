/**
 * Property-based tests for pipeline module (cost estimation, logging, and cost limit evaluation)
 * 
 * **Feature: gram-middleware, Property 2: Cost Estimation Invocation**
 * **Feature: gram-middleware, Property 3: Logging Completeness**
 * **Feature: gram-middleware, Property 4: Custom Hook Routing**
 * **Feature: gram-middleware, Property 5: Strict Mode Blocking**
 * **Feature: gram-middleware, Property 6: Lenient Mode Proceed**
 * **Feature: gram-middleware, Property 7: No-Limit Passthrough**
 * **Validates: Requirements 2.1, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4**
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { Gram } from 'gram-library';
import { 
  estimateCost, 
  evaluateMaxCost, 
  filterFallbacksByProvider,
  findAffordableFallback,
  attemptAutoDowngrade,
  safeEvaluateRequest
} from '../../src/pipeline.js';
import { formatCost, formatLogMessage, logRequestCompletion } from '../../src/utils/logging.js';
import { resolveConfig } from '../../src/config.js';
import { GramLimitError, GramDowngradeError } from '../../src/errors.js';
import type { ResolvedConfig, GramOptions, CostEstimate } from '../../src/types.js';

/**
 * Creates a mock Gram instance with configurable behavior
 */
function createMockGram(options: {
  estimateResult?: { tokens: number; inputCost: number; outputCost: number };
  estimateError?: Error;
} = {}): Gram {
  const mockGram = {
    estimate: vi.fn().mockImplementation(async () => {
      if (options.estimateError) {
        throw options.estimateError;
      }
      return options.estimateResult ?? { tokens: 100, inputCost: 0.001, outputCost: 0.002 };
    }),
    countTokens: vi.fn().mockResolvedValue(100),
    getModel: vi.fn().mockReturnValue({ provider: 'openai', inputPrice: 0.01, outputPrice: 0.03 }),
  } as unknown as Gram;
  return mockGram;
}

/**
 * Creates a resolved config with a mock Gram instance
 */
function createTestConfig(
  gramOptions: Parameters<typeof createMockGram>[0] = {},
  configOptions: GramOptions = {}
): ResolvedConfig {
  const mockGram = createMockGram(gramOptions);
  return resolveConfig({ ...configOptions, gram: mockGram });
}

describe('Pipeline Properties', () => {
  /**
   * **Feature: gram-middleware, Property 2: Cost Estimation Invocation**
   * **Validates: Requirements 2.1, 2.2**
   */
  describe('Property 2: Cost Estimation Invocation', () => {
    it('should call gram.estimate() with messages and model', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.record({ role: fc.string(), content: fc.string() }), { minLength: 1, maxLength: 10 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          async (messages, model) => {
            const config = createTestConfig({
              estimateResult: { tokens: 100, inputCost: 0.001, outputCost: 0.002 }
            });
            
            await estimateCost(messages, model, config);
            
            expect(config.gram.estimate).toHaveBeenCalledTimes(1);
            expect(config.gram.estimate).toHaveBeenCalledWith(messages, model);
          }
        ),
        { numRuns: 100 }
      );
    });


    it('should return CostEstimate with tokens and costs from gram.estimate()', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100000 }),
          fc.float({ min: Math.fround(0.000001), max: Math.fround(10), noNaN: true }),
          fc.float({ min: Math.fround(0.000001), max: Math.fround(10), noNaN: true }),
          async (tokens, inputCost, outputCost) => {
            const config = createTestConfig({
              estimateResult: { tokens, inputCost, outputCost }
            });
            
            const result = await estimateCost([], 'test-model', config);
            
            expect(result).not.toBeNull();
            expect(result!.tokens).toBe(tokens);
            expect(result!.inputCost).toBe(inputCost);
            expect(result!.outputCost).toBe(outputCost);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null and log warning when estimation fails and failOpen is true', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          async (errorMessage, model) => {
            const logMessages: string[] = [];
            const config = createTestConfig(
              { estimateError: new Error(errorMessage) },
              { 
                failOpen: true,
                hooks: { onLog: (msg) => logMessages.push(msg) }
              }
            );
            
            const result = await estimateCost([], model, config);
            
            expect(result).toBeNull();
            expect(logMessages.length).toBe(1);
            expect(logMessages[0]).toContain('Warning');
            expect(logMessages[0]).toContain(model);
            expect(logMessages[0]).toContain(errorMessage);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should throw error when estimation fails and failOpen is false', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          async (errorMessage) => {
            const testError = new Error(errorMessage);
            const config = createTestConfig(
              { estimateError: testError },
              { failOpen: false }
            );
            
            await expect(estimateCost([], 'test-model', config)).rejects.toThrow(testError);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 3: Logging Completeness**
   * **Validates: Requirements 3.1, 3.3**
   */
  describe('Property 3: Logging Completeness', () => {
    it('should format cost in USD with 6 decimal places', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0), max: Math.fround(1000), noNaN: true }),
          (cost) => {
            const formatted = formatCost(cost);
            
            expect(formatted).toMatch(/^\$\d+\.\d{6}$/);
            expect(formatted.startsWith('$')).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include model name in log message', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
          (model, inputTokens, outputTokens, totalCost) => {
            const message = formatLogMessage(model, inputTokens, outputTokens, totalCost);
            
            expect(message).toContain(model);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include input token count in log message', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
          (model, inputTokens, outputTokens, totalCost) => {
            const message = formatLogMessage(model, inputTokens, outputTokens, totalCost);
            
            expect(message).toContain(String(inputTokens));
            expect(message.toLowerCase()).toContain('input');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include output token count in log message', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
          (model, inputTokens, outputTokens, totalCost) => {
            const message = formatLogMessage(model, inputTokens, outputTokens, totalCost);
            
            expect(message).toContain(String(outputTokens));
            expect(message.toLowerCase()).toContain('output');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include cost formatted with at least 4 decimal places in log message', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
          (model, inputTokens, outputTokens, totalCost) => {
            const message = formatLogMessage(model, inputTokens, outputTokens, totalCost);
            
            // Should contain cost with at least 4 decimal places (we use 6)
            expect(message).toMatch(/\$\d+\.\d{4,}/);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 4: Custom Hook Routing**
   * **Validates: Requirements 3.2**
   */
  describe('Property 4: Custom Hook Routing', () => {
    it('should route log messages to custom onLog hook', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
          (model, inputTokens, outputTokens, totalCost) => {
            const logMessages: string[] = [];
            const customHook = (msg: string) => logMessages.push(msg);
            
            const config = resolveConfig({
              hooks: { onLog: customHook }
            });
            
            logRequestCompletion(model, inputTokens, outputTokens, totalCost, config);
            
            expect(logMessages.length).toBe(1);
            expect(logMessages[0]).toContain(model);
            expect(logMessages[0]).toContain(String(inputTokens));
            expect(logMessages[0]).toContain(String(outputTokens));
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not call console.log when custom hook is provided', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
          (model, inputTokens, outputTokens, totalCost) => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const customHook = vi.fn();
            
            const config = resolveConfig({
              hooks: { onLog: customHook }
            });
            
            logRequestCompletion(model, inputTokens, outputTokens, totalCost, config);
            
            expect(customHook).toHaveBeenCalledTimes(1);
            expect(consoleSpy).not.toHaveBeenCalled();
            
            consoleSpy.mockRestore();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use default console.log when no custom hook is provided', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
          (model, inputTokens, outputTokens, totalCost) => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            
            const config = resolveConfig({});
            
            logRequestCompletion(model, inputTokens, outputTokens, totalCost, config);
            
            expect(consoleSpy).toHaveBeenCalledTimes(1);
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(model));
            
            consoleSpy.mockRestore();
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * **Feature: gram-middleware, Property 5: Strict Mode Blocking**
   * **Validates: Requirements 4.1, 4.4**
   * 
   * For any request where estimated input cost exceeds maxCost and strict is true
   * (and autoDowngrade is false or exhausted), a GramLimitError should be thrown
   * containing the estimated cost, maxCost, and model name.
   */
  describe('Property 5: Strict Mode Blocking', () => {
    it('should return error with GramLimitError when cost exceeds maxCost in strict mode', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(1), noNaN: true }),
          fc.float({ min: Math.fround(1.01), max: Math.fround(10), noNaN: true }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (maxCost, costMultiplier, model) => {
            const estimatedCost = maxCost * costMultiplier;
            const estimate: CostEstimate = {
              tokens: 1000,
              inputCost: estimatedCost,
              outputCost: 0.001,
            };
            
            const config = resolveConfig({
              maxCost,
              strict: true,
            });
            
            const result = evaluateMaxCost(estimate, model, config);
            
            expect(result.proceed).toBe(false);
            expect(result.error).toBeInstanceOf(GramLimitError);
            
            const error = result.error as GramLimitError;
            expect(error.estimatedCost).toBe(estimatedCost);
            expect(error.maxCost).toBe(maxCost);
            expect(error.model).toBe(model);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include correct fields in GramLimitError message', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(1), noNaN: true }),
          fc.float({ min: Math.fround(1.01), max: Math.fround(10), noNaN: true }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (maxCost, costMultiplier, model) => {
            const estimatedCost = maxCost * costMultiplier;
            const estimate: CostEstimate = {
              tokens: 1000,
              inputCost: estimatedCost,
              outputCost: 0.001,
            };
            
            const config = resolveConfig({
              maxCost,
              strict: true,
            });
            
            const result = evaluateMaxCost(estimate, model, config);
            
            expect(result.error).toBeDefined();
            expect(result.error!.message).toContain(estimatedCost.toFixed(6));
            expect(result.error!.message).toContain(maxCost.toFixed(6));
            expect(result.error!.message).toContain(model);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 6: Lenient Mode Proceed**
   * **Validates: Requirements 4.2**
   * 
   * For any request where estimated input cost exceeds maxCost and strict is false,
   * the onLimitExceeded hook should be called and the request should proceed to execution.
   */
  describe('Property 6: Lenient Mode Proceed', () => {
    it('should proceed and call onLimitExceeded when cost exceeds maxCost in lenient mode', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(1), noNaN: true }),
          fc.float({ min: Math.fround(1.01), max: Math.fround(10), noNaN: true }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (maxCost, costMultiplier, model) => {
            const estimatedCost = maxCost * costMultiplier;
            const estimate: CostEstimate = {
              tokens: 1000,
              inputCost: estimatedCost,
              outputCost: 0.001,
            };
            
            const limitExceededCalls: CostEstimate[] = [];
            const config = resolveConfig({
              maxCost,
              strict: false,
              hooks: {
                onLimitExceeded: (est) => limitExceededCalls.push(est),
              },
            });
            
            const result = evaluateMaxCost(estimate, model, config);
            
            expect(result.proceed).toBe(true);
            expect(result.error).toBeUndefined();
            expect(limitExceededCalls.length).toBe(1);
            expect(limitExceededCalls[0]).toEqual(estimate);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not throw error in lenient mode even when cost exceeds limit', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(1), noNaN: true }),
          fc.float({ min: Math.fround(1.01), max: Math.fround(10), noNaN: true }),
          (maxCost, costMultiplier) => {
            const estimatedCost = maxCost * costMultiplier;
            const estimate: CostEstimate = {
              tokens: 1000,
              inputCost: estimatedCost,
              outputCost: 0.001,
            };
            
            const config = resolveConfig({
              maxCost,
              strict: false,
            });
            
            // Should not throw
            const result = evaluateMaxCost(estimate, 'test-model', config);
            
            expect(result.proceed).toBe(true);
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 7: No-Limit Passthrough**
   * **Validates: Requirements 4.3**
   * 
   * For any request where maxCost is not configured, the request should proceed
   * to execution without any blocking or limit evaluation.
   */
  describe('Property 7: No-Limit Passthrough', () => {
    it('should proceed without evaluation when maxCost is not configured', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(1000), noNaN: true }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (inputCost, model) => {
            const estimate: CostEstimate = {
              tokens: 1000,
              inputCost,
              outputCost: 0.001,
            };
            
            const limitExceededCalls: CostEstimate[] = [];
            const config = resolveConfig({
              // No maxCost configured
              hooks: {
                onLimitExceeded: (est) => limitExceededCalls.push(est),
              },
            });
            
            const result = evaluateMaxCost(estimate, model, config);
            
            expect(result.proceed).toBe(true);
            expect(result.error).toBeUndefined();
            // onLimitExceeded should NOT be called when no limit is configured
            expect(limitExceededCalls.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should proceed even with very high costs when maxCost is not configured', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(100), max: Math.fround(10000), noNaN: true }),
          (inputCost) => {
            const estimate: CostEstimate = {
              tokens: 1000000,
              inputCost,
              outputCost: inputCost * 2,
            };
            
            const config = resolveConfig({
              // No maxCost configured
            });
            
            const result = evaluateMaxCost(estimate, 'expensive-model', config);
            
            expect(result.proceed).toBe(true);
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve args when proceeding without limit', () => {
      fc.assert(
        fc.property(
          fc.record({
            model: fc.string({ minLength: 1 }),
            messages: fc.array(fc.string()),
          }),
          (args) => {
            const estimate: CostEstimate = {
              tokens: 100,
              inputCost: 0.01,
              outputCost: 0.02,
            };
            
            const config = resolveConfig({
              // No maxCost configured
            });
            
            const result = evaluateMaxCost(estimate, 'test-model', config, args);
            
            expect(result.proceed).toBe(true);
            expect(result.modifiedArgs).toEqual(args);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


/**
 * Creates a mock Gram instance with configurable per-model cost estimates
 */
function createMockGramWithModels(modelCosts: Record<string, { tokens: number; inputCost: number; outputCost: number }>, provider = 'openai'): Gram {
  const mockGram = {
    estimate: vi.fn().mockImplementation((_messages: unknown[], model: string) => {
      const cost = modelCosts[model];
      if (!cost) {
        throw new Error(`Unknown model: ${model}`);
      }
      return cost;
    }),
    countTokens: vi.fn().mockResolvedValue(100),
    getModel: vi.fn().mockImplementation((model: string) => {
      if (modelCosts[model]) {
        return { provider, inputPrice: 0.01, outputPrice: 0.03 };
      }
      return null;
    }),
  } as unknown as Gram;
  return mockGram;
}

describe('Auto-Downgrade Properties', () => {
  /**
   * **Feature: gram-middleware, Property 8: Fallback Iteration Order**
   * **Validates: Requirements 5.1, 5.2**
   * 
   * For any over-budget request with autoDowngrade true and fallbackModels configured,
   * the middleware should try fallback models in the exact order specified.
   */
  describe('Property 8: Fallback Iteration Order', () => {
    it('should iterate through fallback models in exact order specified', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 5 }),
          (fallbackModels) => {
            // Ensure unique model names
            const uniqueFallbacks = [...new Set(fallbackModels)];
            if (uniqueFallbacks.length < 2) return true;

            // Create model costs where all models exceed maxCost
            const maxCost = 0.01;
            const modelCosts: Record<string, { tokens: number; inputCost: number; outputCost: number }> = {};
            uniqueFallbacks.forEach((model, index) => {
              modelCosts[model] = { tokens: 100, inputCost: maxCost * (2 + index), outputCost: 0.001 };
            });
            
            const mockGram = createMockGramWithModels(modelCosts);
            const config = resolveConfig({
              gram: mockGram,
              maxCost,
              autoDowngrade: true,
              fallbackModels: uniqueFallbacks,
              strict: false,
            });
            
            const result = findAffordableFallback([], uniqueFallbacks, maxCost, config);
            
            // Should have tried all models in order
            expect(result.attemptedModels).toEqual(uniqueFallbacks);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should re-estimate cost for each fallback model', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
          (fallbackModels) => {
            const uniqueFallbacks = [...new Set(fallbackModels)];
            if (uniqueFallbacks.length < 1) return true;
            
            const maxCost = 0.01;
            const modelCosts: Record<string, { tokens: number; inputCost: number; outputCost: number }> = {};
            uniqueFallbacks.forEach((model, index) => {
              modelCosts[model] = { tokens: 100, inputCost: maxCost * (2 + index), outputCost: 0.001 };
            });
            
            const mockGram = createMockGramWithModels(modelCosts);
            const config = resolveConfig({
              gram: mockGram,
              maxCost,
              autoDowngrade: true,
              fallbackModels: uniqueFallbacks,
            });

            findAffordableFallback([], uniqueFallbacks, maxCost, config);
            
            // Should have called estimate for each fallback model
            expect(mockGram.estimate).toHaveBeenCalledTimes(uniqueFallbacks.length);
            uniqueFallbacks.forEach((model, index) => {
              expect(mockGram.estimate).toHaveBeenNthCalledWith(index + 1, [], model);
            });
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 9: Successful Downgrade**
   * **Validates: Requirements 5.3, 5.4**
   * 
   * For any fallback model whose estimated cost fits within maxCost, the request
   * should be modified to use that model, and onDowngrade should be called.
   */
  describe('Property 9: Successful Downgrade', () => {
    it('should return first affordable fallback model', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(0.1), noNaN: true }),
          fc.integer({ min: 1, max: 5 }),
          (maxCost, affordableIndex) => {
            const fallbackModels = ['model-a', 'model-b', 'model-c', 'model-d', 'model-e'];
            const actualAffordableIndex = Math.min(affordableIndex, fallbackModels.length - 1);
            
            const modelCosts: Record<string, { tokens: number; inputCost: number; outputCost: number }> = {};
            fallbackModels.forEach((model, index) => {
              // Models before affordableIndex exceed maxCost, the rest are affordable
              const cost = index < actualAffordableIndex ? maxCost * 2 : maxCost * 0.5;
              modelCosts[model] = { tokens: 100, inputCost: cost, outputCost: 0.001 };
            });
            
            const mockGram = createMockGramWithModels(modelCosts);
            const config = resolveConfig({
              gram: mockGram,
              maxCost,
              autoDowngrade: true,
              fallbackModels,
            });

            const result = findAffordableFallback([], fallbackModels, maxCost, config);
            
            expect(result.found).toBe(true);
            expect(result.model).toBe(fallbackModels[actualAffordableIndex]);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should call onDowngrade hook with original model, new model, and positive savings', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.01), max: Math.fround(1), noNaN: true }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (maxCost, originalModel, fallbackModel) => {
            if (originalModel === fallbackModel) return true;
            
            const originalCost = maxCost * 2;
            const fallbackCost = maxCost * 0.5;
            
            const modelCosts: Record<string, { tokens: number; inputCost: number; outputCost: number }> = {
              [originalModel]: { tokens: 100, inputCost: originalCost, outputCost: 0.001 },
              [fallbackModel]: { tokens: 100, inputCost: fallbackCost, outputCost: 0.001 },
            };
            
            const mockGram = createMockGramWithModels(modelCosts);
            const downgradeCalls: Array<{ original: string; newModel: string; savings: number }> = [];
            
            const config = resolveConfig({
              gram: mockGram,
              maxCost,
              autoDowngrade: true,
              fallbackModels: [fallbackModel],
              hooks: {
                onDowngrade: (orig, newM, sav) => downgradeCalls.push({ original: orig, newModel: newM, savings: sav }),
              },
            });
            
            const originalEstimate: CostEstimate = { tokens: 100, inputCost: originalCost, outputCost: 0.001 };
            const args = { model: originalModel };
            const setModel = (a: typeof args, m: string) => ({ ...a, model: m });

            const result = attemptAutoDowngrade([], originalModel, originalEstimate, 'openai', config, args, setModel);
            
            expect(result.proceed).toBe(true);
            expect(result.downgraded).toBeDefined();
            expect(result.downgraded!.from).toBe(originalModel);
            expect(result.downgraded!.to).toBe(fallbackModel);
            expect(result.downgraded!.savings).toBeGreaterThan(0);
            
            expect(downgradeCalls.length).toBe(1);
            expect(downgradeCalls[0].original).toBe(originalModel);
            expect(downgradeCalls[0].newModel).toBe(fallbackModel);
            expect(downgradeCalls[0].savings).toBeCloseTo(originalCost - fallbackCost, 5);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should modify args with new model on successful downgrade', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.01), max: Math.fround(1), noNaN: true }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (maxCost, originalModel, fallbackModel) => {
            if (originalModel === fallbackModel) return true;
            
            const modelCosts: Record<string, { tokens: number; inputCost: number; outputCost: number }> = {
              [originalModel]: { tokens: 100, inputCost: maxCost * 2, outputCost: 0.001 },
              [fallbackModel]: { tokens: 100, inputCost: maxCost * 0.5, outputCost: 0.001 },
            };
            
            const mockGram = createMockGramWithModels(modelCosts);
            const config = resolveConfig({
              gram: mockGram,
              maxCost,
              autoDowngrade: true,
              fallbackModels: [fallbackModel],
            });
            
            const originalEstimate: CostEstimate = { tokens: 100, inputCost: maxCost * 2, outputCost: 0.001 };
            const args = { model: originalModel, messages: [] };
            const setModel = (a: typeof args, m: string) => ({ ...a, model: m });

            const result = attemptAutoDowngrade([], originalModel, originalEstimate, 'openai', config, args, setModel);
            
            expect(result.proceed).toBe(true);
            expect(result.modifiedArgs).toBeDefined();
            expect(result.modifiedArgs!.model).toBe(fallbackModel);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 10: Exhausted Fallbacks Strict**
   * **Validates: Requirements 5.5**
   * 
   * For any request where all fallback models exceed maxCost and strict is true,
   * a GramDowngradeError should be thrown containing the original model and list of attempted fallbacks.
   */
  describe('Property 10: Exhausted Fallbacks Strict', () => {
    it('should return GramDowngradeError when all fallbacks exceed maxCost in strict mode', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(0.1), noNaN: true }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
          (maxCost, originalModel, fallbackModels) => {
            const uniqueFallbacks = [...new Set(fallbackModels.filter(m => m !== originalModel))];
            if (uniqueFallbacks.length < 1) return true;
            
            // All models exceed maxCost
            const modelCosts: Record<string, { tokens: number; inputCost: number; outputCost: number }> = {
              [originalModel]: { tokens: 100, inputCost: maxCost * 2, outputCost: 0.001 },
            };
            uniqueFallbacks.forEach((model, index) => {
              modelCosts[model] = { tokens: 100, inputCost: maxCost * (2 + index), outputCost: 0.001 };
            });
            
            const mockGram = createMockGramWithModels(modelCosts);
            const config = resolveConfig({
              gram: mockGram,
              maxCost,
              autoDowngrade: true,
              fallbackModels: uniqueFallbacks,
              strict: true,
            });

            const originalEstimate: CostEstimate = { tokens: 100, inputCost: maxCost * 2, outputCost: 0.001 };
            const args = { model: originalModel };
            const setModel = (a: typeof args, m: string) => ({ ...a, model: m });
            
            const result = attemptAutoDowngrade([], originalModel, originalEstimate, 'openai', config, args, setModel);
            
            expect(result.proceed).toBe(false);
            expect(result.error).toBeInstanceOf(GramDowngradeError);
            
            const error = result.error as GramDowngradeError;
            expect(error.originalModel).toBe(originalModel);
            expect(error.attemptedFallbacks).toEqual(uniqueFallbacks);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 11: Exhausted Fallbacks Lenient**
   * **Validates: Requirements 5.6**
   * 
   * For any request where all fallback models exceed maxCost and strict is false,
   * onLimitExceeded should be called and the request should proceed with the original model.
   */
  describe('Property 11: Exhausted Fallbacks Lenient', () => {
    it('should proceed and call onLimitExceeded when all fallbacks exhausted in lenient mode', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(0.1), noNaN: true }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
          (maxCost, originalModel, fallbackModels) => {
            const uniqueFallbacks = [...new Set(fallbackModels.filter(m => m !== originalModel))];
            if (uniqueFallbacks.length < 1) return true;
            
            // All models exceed maxCost
            const modelCosts: Record<string, { tokens: number; inputCost: number; outputCost: number }> = {
              [originalModel]: { tokens: 100, inputCost: maxCost * 2, outputCost: 0.001 },
            };
            uniqueFallbacks.forEach((model, index) => {
              modelCosts[model] = { tokens: 100, inputCost: maxCost * (2 + index), outputCost: 0.001 };
            });

            const mockGram = createMockGramWithModels(modelCosts);
            const limitExceededCalls: CostEstimate[] = [];
            
            const config = resolveConfig({
              gram: mockGram,
              maxCost,
              autoDowngrade: true,
              fallbackModels: uniqueFallbacks,
              strict: false,
              hooks: {
                onLimitExceeded: (est) => limitExceededCalls.push(est),
              },
            });
            
            const originalEstimate: CostEstimate = { tokens: 100, inputCost: maxCost * 2, outputCost: 0.001 };
            const args = { model: originalModel };
            const setModel = (a: typeof args, m: string) => ({ ...a, model: m });
            
            const result = attemptAutoDowngrade([], originalModel, originalEstimate, 'openai', config, args, setModel);
            
            expect(result.proceed).toBe(true);
            expect(result.error).toBeUndefined();
            expect(limitExceededCalls.length).toBe(1);
            expect(limitExceededCalls[0]).toEqual(originalEstimate);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 22: Fallback Provider Awareness**
   * **Validates: Requirements 5.1, 5.8**
   * 
   * For any fallback iteration, only models belonging to the same provider as the
   * wrapped SDK should be considered.
   */
  describe('Property 22: Fallback Provider Awareness', () => {
    it('should filter fallback models to same provider only', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
          (openaiModels, anthropicModels) => {
            const uniqueOpenai = [...new Set(openaiModels)];
            const uniqueAnthropic = [...new Set(anthropicModels.filter(m => !uniqueOpenai.includes(m)))];
            if (uniqueOpenai.length < 1 || uniqueAnthropic.length < 1) return true;

            // Create a mock gram that returns different providers for different models
            const mockGram = {
              estimate: vi.fn().mockReturnValue({ tokens: 100, inputCost: 0.001, outputCost: 0.001 }),
              countTokens: vi.fn().mockResolvedValue(100),
              getModel: vi.fn().mockImplementation((model: string) => {
                if (uniqueOpenai.includes(model)) {
                  return { provider: 'openai', inputPrice: 0.01, outputPrice: 0.03 };
                }
                if (uniqueAnthropic.includes(model)) {
                  return { provider: 'anthropic', inputPrice: 0.01, outputPrice: 0.03 };
                }
                return null;
              }),
            } as unknown as Gram;
            
            const allFallbacks = [...uniqueOpenai, ...uniqueAnthropic];
            const config = resolveConfig({
              gram: mockGram,
              maxCost: 0.01,
              autoDowngrade: true,
              fallbackModels: allFallbacks,
            });
            
            // Filter for OpenAI provider
            const openaiFiltered = filterFallbacksByProvider(allFallbacks, 'openai', config);
            expect(openaiFiltered).toEqual(uniqueOpenai);
            
            // Filter for Anthropic provider
            const anthropicFiltered = filterFallbacksByProvider(allFallbacks, 'anthropic', config);
            expect(anthropicFiltered).toEqual(uniqueAnthropic);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should skip cross-provider models during fallback iteration', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (originalModel, openaiModel, anthropicModel) => {
            // Ensure all models are unique
            if (originalModel === openaiModel || originalModel === anthropicModel || openaiModel === anthropicModel) {
              return true;
            }

            const maxCost = 0.01;
            
            // Create a mock gram that returns different providers
            const mockGram = {
              estimate: vi.fn().mockImplementation((_messages: unknown[], model: string) => {
                // OpenAI model is affordable, Anthropic model is also affordable
                return { tokens: 100, inputCost: maxCost * 0.5, outputCost: 0.001 };
              }),
              countTokens: vi.fn().mockResolvedValue(100),
              getModel: vi.fn().mockImplementation((model: string) => {
                if (model === originalModel || model === openaiModel) {
                  return { provider: 'openai', inputPrice: 0.01, outputPrice: 0.03 };
                }
                if (model === anthropicModel) {
                  return { provider: 'anthropic', inputPrice: 0.01, outputPrice: 0.03 };
                }
                return null;
              }),
            } as unknown as Gram;
            
            const config = resolveConfig({
              gram: mockGram,
              maxCost,
              autoDowngrade: true,
              fallbackModels: [anthropicModel, openaiModel], // Anthropic first, then OpenAI
              strict: true,
            });
            
            const originalEstimate: CostEstimate = { tokens: 100, inputCost: maxCost * 2, outputCost: 0.001 };
            const args = { model: originalModel };
            const setModel = (a: typeof args, m: string) => ({ ...a, model: m });
            
            // When using OpenAI provider, should skip Anthropic model and use OpenAI model
            const result = attemptAutoDowngrade([], originalModel, originalEstimate, 'openai', config, args, setModel);
            
            expect(result.proceed).toBe(true);
            expect(result.downgraded).toBeDefined();
            expect(result.downgraded!.to).toBe(openaiModel); // Should use OpenAI model, not Anthropic
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


/**
 * Output Capping Properties
 * 
 * **Feature: gram-middleware, Property 13: Output Cap Calculation**
 * **Feature: gram-middleware, Property 14: Output Cap Application**
 * **Feature: gram-middleware, Property 15: Output Cap Threshold Skip**
 * **Feature: gram-middleware, Property 16: Output Cap No-Config Skip**
 * **Feature: gram-middleware, Property 17: Output Cap Precedence**
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.7**
 */

import { calculateMaxAffordableOutputTokens } from '../../src/utils/cost.js';
import { evaluateOutputCap, applyOutputCap } from '../../src/pipeline.js';

describe('Output Capping Properties', () => {
  /**
   * **Feature: gram-middleware, Property 13: Output Cap Calculation**
   * **Validates: Requirements 6.1**
   * 
   * For any configuration with remainingBudget, the maximum affordable output tokens
   * should equal (remainingBudget - inputCost) / (outputPrice / 1,000,000) rounded down.
   */
  describe('Property 13: Output Cap Calculation', () => {
    it('should calculate max tokens as (remainingBudget - inputCost) / (outputPrice / 1_000_000) floored', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.01), max: Math.fround(10), noNaN: true }),
          fc.float({ min: Math.fround(0.001), max: Math.fround(5), noNaN: true }),
          fc.float({ min: Math.fround(0.01), max: Math.fround(100), noNaN: true }),
          (remainingBudget, inputCost, outputPrice) => {
            // Ensure remainingBudget > inputCost for meaningful test
            const actualRemainingBudget = inputCost + Math.abs(remainingBudget);
            
            const result = calculateMaxAffordableOutputTokens(
              actualRemainingBudget,
              inputCost,
              outputPrice
            );
            
            // Calculate expected value
            const availableBudget = actualRemainingBudget - inputCost;
            const pricePerToken = outputPrice / 1_000_000;
            const expected = Math.floor(availableBudget / pricePerToken);
            
            expect(result).toBe(expected);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return 0 when remainingBudget is less than or equal to inputCost', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(10), noNaN: true }),
          fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }),
          fc.float({ min: Math.fround(0.01), max: Math.fround(100), noNaN: true }),
          (inputCost, budgetRatio, outputPrice) => {
            // remainingBudget <= inputCost
            const remainingBudget = inputCost * budgetRatio;
            
            const result = calculateMaxAffordableOutputTokens(
              remainingBudget,
              inputCost,
              outputPrice
            );
            
            expect(result).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return integer (floor) of calculated tokens', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.01), max: Math.fround(10), noNaN: true }),
          fc.float({ min: Math.fround(0.001), max: Math.fround(5), noNaN: true }),
          fc.float({ min: Math.fround(0.01), max: Math.fround(100), noNaN: true }),
          (remainingBudget, inputCost, outputPrice) => {
            const actualRemainingBudget = inputCost + Math.abs(remainingBudget);
            
            const result = calculateMaxAffordableOutputTokens(
              actualRemainingBudget,
              inputCost,
              outputPrice
            );
            
            // Result should be an integer
            expect(Number.isInteger(result)).toBe(true);
            expect(result).toBe(Math.floor(result));
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 14: Output Cap Application**
   * **Validates: Requirements 6.2, 6.4**
   * 
   * For any calculated max output tokens less than minOutputTokens, the request's
   * max_tokens should be set to the calculated value and onOutputCapped should be called.
   */
  describe('Property 14: Output Cap Application', () => {
    it('should set max_tokens and call onOutputCapped when calculated tokens < minOutputTokens', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 1000 }),
          fc.integer({ min: 1, max: 99 }),
          (minOutputTokens, calculatedTokensRatio) => {
            // Ensure calculated tokens < minOutputTokens
            const calculatedTokens = Math.floor(minOutputTokens * (calculatedTokensRatio / 100));
            if (calculatedTokens >= minOutputTokens || calculatedTokens <= 0) return true;
            
            // Set up budget to produce calculatedTokens
            const outputPrice = 10; // $10 per 1M tokens
            const inputCost = 0.001;
            const pricePerToken = outputPrice / 1_000_000;
            const remainingBudget = inputCost + (calculatedTokens * pricePerToken) + 0.0000001;
            
            const outputCappedCalls: Array<{ maxTokens: number; reason: string }> = [];
            const config = resolveConfig({
              remainingBudget,
              minOutputTokens,
              hooks: {
                onOutputCapped: (tokens, reason) => outputCappedCalls.push({ maxTokens: tokens, reason }),
              },
            });
            
            const estimate: CostEstimate = {
              tokens: 100,
              inputCost,
              outputCost: outputPrice,
            };
            
            const args = { model: 'test-model', max_tokens: undefined as number | undefined };
            const getMaxTokens = (a: typeof args) => a.max_tokens;
            const setMaxTokens = (a: typeof args, t: number) => ({ ...a, max_tokens: t });
            
            const result = applyOutputCap(estimate, 'test-model', config, args, getMaxTokens, setMaxTokens);
            
            expect(result.outputCapped).toBeDefined();
            expect(result.args.max_tokens).toBe(calculatedTokens);
            expect(outputCappedCalls.length).toBe(1);
            expect(outputCappedCalls[0].maxTokens).toBe(calculatedTokens);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 15: Output Cap Threshold Skip**
   * **Validates: Requirements 6.3**
   * 
   * For any calculated max output tokens >= minOutputTokens, the request's
   * max_tokens should not be modified by the middleware.
   */
  describe('Property 15: Output Cap Threshold Skip', () => {
    it('should not modify max_tokens when calculated tokens >= minOutputTokens', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 1000 }),
          fc.float({ min: Math.fround(1), max: Math.fround(10), noNaN: true }),
          (minOutputTokens, multiplier) => {
            // Ensure calculated tokens >= minOutputTokens
            const calculatedTokens = Math.floor(minOutputTokens * multiplier);
            
            // Set up budget to produce calculatedTokens
            const outputPrice = 10;
            const inputCost = 0.001;
            const pricePerToken = outputPrice / 1_000_000;
            const remainingBudget = inputCost + (calculatedTokens * pricePerToken) + 0.0001;
            
            const outputCappedCalls: Array<{ maxTokens: number; reason: string }> = [];
            const config = resolveConfig({
              remainingBudget,
              minOutputTokens,
              hooks: {
                onOutputCapped: (tokens, reason) => outputCappedCalls.push({ maxTokens: tokens, reason }),
              },
            });
            
            const estimate: CostEstimate = {
              tokens: 100,
              inputCost,
              outputCost: outputPrice,
            };
            
            const originalMaxTokens = 2000;
            const args = { model: 'test-model', max_tokens: originalMaxTokens };
            const getMaxTokens = (a: typeof args) => a.max_tokens;
            const setMaxTokens = (a: typeof args, t: number) => ({ ...a, max_tokens: t });
            
            const result = applyOutputCap(estimate, 'test-model', config, args, getMaxTokens, setMaxTokens);
            
            // Should not cap
            expect(result.outputCapped).toBeUndefined();
            expect(result.args.max_tokens).toBe(originalMaxTokens);
            expect(outputCappedCalls.length).toBe(0);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 16: Output Cap No-Config Skip**
   * **Validates: Requirements 6.5**
   * 
   * For any request where remainingBudget is not configured, output capping
   * logic should be skipped entirely.
   */
  describe('Property 16: Output Cap No-Config Skip', () => {
    it('should skip output capping when remainingBudget is not configured', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(10), noNaN: true }),
          fc.integer({ min: 100, max: 10000 }),
          (inputCost, originalMaxTokens) => {
            const outputCappedCalls: Array<{ maxTokens: number; reason: string }> = [];
            const config = resolveConfig({
              // No remainingBudget configured
              hooks: {
                onOutputCapped: (tokens, reason) => outputCappedCalls.push({ maxTokens: tokens, reason }),
              },
            });
            
            const estimate: CostEstimate = {
              tokens: 100,
              inputCost,
              outputCost: 10,
            };
            
            const args = { model: 'test-model', max_tokens: originalMaxTokens };
            const getMaxTokens = (a: typeof args) => a.max_tokens;
            const setMaxTokens = (a: typeof args, t: number) => ({ ...a, max_tokens: t });
            
            const result = applyOutputCap(estimate, 'test-model', config, args, getMaxTokens, setMaxTokens);
            
            // Should not cap
            expect(result.outputCapped).toBeUndefined();
            expect(result.args.max_tokens).toBe(originalMaxTokens);
            expect(outputCappedCalls.length).toBe(0);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not evaluate output cap formula when remainingBudget is null', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(1000), noNaN: true }),
          (inputCost) => {
            const config = resolveConfig({
              // No remainingBudget
            });
            
            const estimate: CostEstimate = {
              tokens: 100,
              inputCost,
              outputCost: 10,
            };
            
            const result = evaluateOutputCap(estimate, 'test-model', config);
            
            expect(result.shouldCap).toBe(false);
            expect(result.maxTokens).toBeUndefined();
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 17: Output Cap Precedence**
   * **Validates: Requirements 6.7**
   * 
   * For any request where both developer and middleware specify max_tokens,
   * the final value should be the minimum of the two (lower value wins).
   */
  describe('Property 17: Output Cap Precedence', () => {
    it('should use minimum of developer and calculated max_tokens', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10, max: 500 }),
          fc.integer({ min: 10, max: 500 }),
          fc.integer({ min: 501, max: 2000 }),
          (developerTokens, calculatedTokens, minOutputTokens) => {
            // Ensure calculated tokens < minOutputTokens to trigger capping
            if (calculatedTokens >= minOutputTokens) return true;
            
            // Set up budget to produce calculatedTokens
            const outputPrice = 10;
            const inputCost = 0.001;
            const pricePerToken = outputPrice / 1_000_000;
            const remainingBudget = inputCost + (calculatedTokens * pricePerToken) + 0.0000001;
            
            const config = resolveConfig({
              remainingBudget,
              minOutputTokens,
            });
            
            const estimate: CostEstimate = {
              tokens: 100,
              inputCost,
              outputCost: outputPrice,
            };
            
            const args = { model: 'test-model', max_tokens: developerTokens };
            const getMaxTokens = (a: typeof args) => a.max_tokens;
            const setMaxTokens = (a: typeof args, t: number) => ({ ...a, max_tokens: t });
            
            const result = applyOutputCap(estimate, 'test-model', config, args, getMaxTokens, setMaxTokens);
            
            // Should use minimum of developer and calculated
            const expectedMaxTokens = Math.min(developerTokens, calculatedTokens);
            expect(result.args.max_tokens).toBe(expectedMaxTokens);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use calculated tokens when developer max_tokens is undefined', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10, max: 400 }),
          fc.integer({ min: 500, max: 2000 }),
          (calculatedTokens, minOutputTokens) => {
            // Ensure calculated tokens < minOutputTokens to trigger capping
            if (calculatedTokens >= minOutputTokens) return true;
            
            const outputPrice = 10;
            const inputCost = 0.001;
            const pricePerToken = outputPrice / 1_000_000;
            const remainingBudget = inputCost + (calculatedTokens * pricePerToken) + 0.0000001;
            
            const config = resolveConfig({
              remainingBudget,
              minOutputTokens,
            });
            
            const estimate: CostEstimate = {
              tokens: 100,
              inputCost,
              outputCost: outputPrice,
            };
            
            const args = { model: 'test-model', max_tokens: undefined as number | undefined };
            const getMaxTokens = (a: typeof args) => a.max_tokens;
            const setMaxTokens = (a: typeof args, t: number) => ({ ...a, max_tokens: t });
            
            const result = applyOutputCap(estimate, 'test-model', config, args, getMaxTokens, setMaxTokens);
            
            expect(result.args.max_tokens).toBe(calculatedTokens);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use developer tokens when they are lower than calculated', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10, max: 100 }),
          fc.integer({ min: 200, max: 400 }),
          fc.integer({ min: 500, max: 2000 }),
          (developerTokens, calculatedTokens, minOutputTokens) => {
            // Ensure developer < calculated < minOutputTokens
            if (developerTokens >= calculatedTokens || calculatedTokens >= minOutputTokens) return true;
            
            const outputPrice = 10;
            const inputCost = 0.001;
            const pricePerToken = outputPrice / 1_000_000;
            const remainingBudget = inputCost + (calculatedTokens * pricePerToken) + 0.0000001;
            
            const config = resolveConfig({
              remainingBudget,
              minOutputTokens,
            });
            
            const estimate: CostEstimate = {
              tokens: 100,
              inputCost,
              outputCost: outputPrice,
            };
            
            const args = { model: 'test-model', max_tokens: developerTokens };
            const getMaxTokens = (a: typeof args) => a.max_tokens;
            const setMaxTokens = (a: typeof args, t: number) => ({ ...a, max_tokens: t });
            
            const result = applyOutputCap(estimate, 'test-model', config, args, getMaxTokens, setMaxTokens);
            
            // Developer tokens are lower, so should use those
            expect(result.args.max_tokens).toBe(developerTokens);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


/**
 * Creates a mock Gram instance that throws errors on estimate
 * but does NOT get caught by estimateCost's internal error handling
 * (simulating unexpected errors in the pipeline)
 */
function createErrorThrowingGram(error: Error): Gram {
  const mockGram = {
    estimate: vi.fn().mockImplementation(() => {
      throw error;
    }),
    countTokens: vi.fn().mockResolvedValue(100),
    getModel: vi.fn().mockReturnValue({ provider: 'openai', inputPrice: 0.01, outputPrice: 0.03 }),
  } as unknown as Gram;
  return mockGram;
}

/**
 * Fail-Safe Error Handling Properties
 * 
 * **Feature: gram-middleware, Property 18: FailOpen Error Recovery**
 * **Feature: gram-middleware, Property 19: FailClosed Error Propagation**
 * **Validates: Requirements 8.1, 8.2, 8.3**
 */
describe('Fail-Safe Error Handling Properties', () => {
  /**
   * **Feature: gram-middleware, Property 18: FailOpen Error Recovery**
   * **Validates: Requirements 8.1, 8.3**
   * 
   * For any error thrown by gram-library or internal middleware logic when failOpen is true,
   * the error should be logged and the original request should proceed unchanged.
   * 
   * Note: The estimateCost function already handles gram-library errors internally when failOpen is true,
   * returning null and logging a warning. This test verifies that behavior through the estimateCost function.
   */
  describe('Property 18: FailOpen Error Recovery', () => {
    it('should return null and log warning when gram-library throws and failOpen is true (via estimateCost)', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (errorMessage, model) => {
            const testError = new Error(errorMessage);
            const mockGram = createErrorThrowingGram(testError);
            const logMessages: string[] = [];
            
            const config = resolveConfig({
              gram: mockGram,
              failOpen: true,
              hooks: {
                onLog: (msg) => logMessages.push(msg),
              },
            });
            
            // estimateCost handles failOpen internally
            const result = estimateCost([], model, config);
            
            // Should return null (estimation failed)
            expect(result).toBeNull();
            
            // Should have logged a warning
            expect(logMessages.length).toBe(1);
            expect(logMessages[0]).toContain('Warning');
            expect(logMessages[0]).toContain(model);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should proceed with original args when estimation fails and failOpen is true (via safeEvaluateRequest)', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.record({
            model: fc.string({ minLength: 1, maxLength: 50 }),
            messages: fc.array(fc.record({ role: fc.string(), content: fc.string() })),
          }),
          (errorMessage, originalArgs) => {
            const testError = new Error(errorMessage);
            const mockGram = createErrorThrowingGram(testError);
            
            const config = resolveConfig({
              gram: mockGram,
              failOpen: true,
              // No maxCost - so even if estimation fails, we proceed
            });
            
            const setModel = (args: typeof originalArgs, model: string) => ({ ...args, model });
            
            const result = safeEvaluateRequest(
              originalArgs.messages,
              originalArgs.model,
              'openai',
              config,
              originalArgs,
              setModel
            );
            
            // Should proceed with original args (estimation returned null, no maxCost to evaluate)
            expect(result.proceed).toBe(true);
            expect(result.modifiedArgs).toEqual(originalArgs);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not modify original args when estimation fails', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.record({
            model: fc.string({ minLength: 1, maxLength: 50 }),
            messages: fc.array(fc.string()),
            max_tokens: fc.integer({ min: 100, max: 4000 }),
          }),
          (errorMessage, originalArgs) => {
            const testError = new Error(errorMessage);
            const mockGram = createErrorThrowingGram(testError);
            
            const config = resolveConfig({
              gram: mockGram,
              failOpen: true,
            });
            
            const argsCopy = { ...originalArgs };
            const setModel = (a: typeof originalArgs, m: string) => ({ ...a, model: m });
            
            const result = safeEvaluateRequest([], originalArgs.model, 'openai', config, originalArgs, setModel);
            
            // Original args should be unchanged
            expect(result.modifiedArgs).toEqual(argsCopy);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle any type of error when failOpen is true', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string({ minLength: 1 }).map(msg => new Error(msg)),
            fc.string({ minLength: 1 }).map(msg => new TypeError(msg)),
            fc.string({ minLength: 1 }).map(msg => new RangeError(msg))
          ),
          (error) => {
            const mockGram = createErrorThrowingGram(error);
            
            const config = resolveConfig({
              gram: mockGram,
              failOpen: true,
            });
            
            const args = { model: 'test-model' };
            const setModel = (a: typeof args, m: string) => ({ ...a, model: m });
            
            // Should not throw - estimateCost catches the error
            const result = safeEvaluateRequest([], 'test-model', 'openai', config, args, setModel);
            
            expect(result.proceed).toBe(true);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 19: FailClosed Error Propagation**
   * **Validates: Requirements 8.2**
   * 
   * For any error thrown by gram-library when failOpen is false,
   * the error should be propagated to the caller.
   */
  describe('Property 19: FailClosed Error Propagation', () => {
    it('should propagate error when gram-library throws and failOpen is false (via estimateCost)', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (errorMessage) => {
            const testError = new Error(errorMessage);
            const mockGram = createErrorThrowingGram(testError);
            
            const config = resolveConfig({
              gram: mockGram,
              failOpen: false,
            });
            
            // estimateCost should propagate the error when failOpen is false
            expect(() => {
              estimateCost([], 'test-model', config);
            }).toThrow(testError);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should propagate error through safeEvaluateRequest when failOpen is false', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (errorMessage) => {
            const testError = new Error(errorMessage);
            const mockGram = createErrorThrowingGram(testError);
            
            const config = resolveConfig({
              gram: mockGram,
              failOpen: false,
            });
            
            const args = { model: 'test-model' };
            const setModel = (a: typeof args, m: string) => ({ ...a, model: m });
            
            expect(() => {
              safeEvaluateRequest([], 'test-model', 'openai', config, args, setModel);
            }).toThrow(testError);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve error type when propagating', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string({ minLength: 1 }).map(msg => new Error(msg)),
            fc.string({ minLength: 1 }).map(msg => new TypeError(msg)),
            fc.string({ minLength: 1 }).map(msg => new RangeError(msg))
          ),
          (error) => {
            const mockGram = createErrorThrowingGram(error);
            
            const config = resolveConfig({
              gram: mockGram,
              failOpen: false,
            });
            
            const args = { model: 'test-model' };
            const setModel = (a: typeof args, m: string) => ({ ...a, model: m });
            
            try {
              safeEvaluateRequest([], 'test-model', 'openai', config, args, setModel);
              // Should have thrown
              return false;
            } catch (e) {
              // Error should be the same instance
              expect(e).toBe(error);
              return true;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve error message when propagating', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (errorMessage) => {
            const testError = new Error(errorMessage);
            const mockGram = createErrorThrowingGram(testError);
            
            const config = resolveConfig({
              gram: mockGram,
              failOpen: false,
            });
            
            const args = { model: 'test-model' };
            const setModel = (a: typeof args, m: string) => ({ ...a, model: m });
            
            try {
              safeEvaluateRequest([], 'test-model', 'openai', config, args, setModel);
              return false;
            } catch (e) {
              expect((e as Error).message).toBe(errorMessage);
              return true;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not log error recovery message when failOpen is false', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (errorMessage) => {
            const testError = new Error(errorMessage);
            const mockGram = createErrorThrowingGram(testError);
            const logMessages: string[] = [];
            
            const config = resolveConfig({
              gram: mockGram,
              failOpen: false,
              hooks: {
                onLog: (msg) => logMessages.push(msg),
              },
            });
            
            const args = { model: 'test-model' };
            const setModel = (a: typeof args, m: string) => ({ ...a, model: m });
            
            try {
              safeEvaluateRequest([], 'test-model', 'openai', config, args, setModel);
            } catch {
              // Expected to throw
            }
            
            // Should not have logged any error recovery messages
            expect(logMessages.filter(msg => msg.includes('proceeding with original'))).toHaveLength(0);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
