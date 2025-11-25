/**
 * Property-based tests for configuration module
 * 
 * **Feature: gram-middleware, Property 20: Configuration Defaults**
 * **Feature: gram-middleware, Property 21: Configuration Validation**
 * **Validates: Requirements 10.1, 10.3, 10.4, 10.5, 10.6, 10.7**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Gram } from 'gram-library';
import { validateConfig, resolveConfig } from '../../src/config.js';
import { GramConfigError } from '../../src/errors.js';
import type { GramOptions } from '../../src/types.js';

describe('Configuration Properties', () => {
  /**
   * **Feature: gram-middleware, Property 20: Configuration Defaults**
   * **Validates: Requirements 10.1, 10.3, 10.4**
   * 
   * For any call to withGram() with partial or no options, the resolved configuration
   * should have correct defaults: failOpen=true, minOutputTokens=500, 
   * strict=true if maxCost set else false.
   */
  describe('Property 20: Configuration Defaults', () => {
    it('should default failOpen to true when not specified', () => {
      fc.assert(
        fc.property(
          fc.option(fc.float({ min: Math.fround(0.001), max: Math.fround(100), noNaN: true }), { nil: undefined }),
          (maxCost) => {
            const options: GramOptions = maxCost !== undefined ? { maxCost } : {};
            const resolved = resolveConfig(options);
            
            expect(resolved.failOpen).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should default minOutputTokens to 500 when not specified', () => {
      fc.assert(
        fc.property(
          fc.option(fc.float({ min: Math.fround(0.001), max: Math.fround(100), noNaN: true }), { nil: undefined }),
          (maxCost) => {
            const options: GramOptions = maxCost !== undefined ? { maxCost } : {};
            const resolved = resolveConfig(options);
            
            expect(resolved.minOutputTokens).toBe(500);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should default strict to true when maxCost is provided', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(100), noNaN: true }),
          (maxCost) => {
            const options: GramOptions = { maxCost };
            const resolved = resolveConfig(options);
            
            expect(resolved.strict).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should default strict to false when maxCost is not provided', () => {
      fc.assert(
        fc.property(
          fc.record({
            autoDowngrade: fc.option(fc.boolean(), { nil: undefined }),
            failOpen: fc.option(fc.boolean(), { nil: undefined }),
          }),
          (partialOptions) => {
            // Ensure maxCost is not set
            const options: GramOptions = {
              autoDowngrade: partialOptions.autoDowngrade,
              failOpen: partialOptions.failOpen,
            };
            const resolved = resolveConfig(options);
            
            expect(resolved.strict).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should create a Gram instance when not provided', () => {
      const resolved = resolveConfig({});
      expect(resolved.gram).toBeInstanceOf(Gram);
    });

    it('should use provided Gram instance when specified', () => {
      const customGram = new Gram();
      const resolved = resolveConfig({ gram: customGram });
      expect(resolved.gram).toBe(customGram);
    });

    it('should create no-op hooks for undefined hooks', () => {
      fc.assert(
        fc.property(
          fc.constant(undefined),
          () => {
            const resolved = resolveConfig({});
            
            // Hooks should be defined and callable without throwing
            expect(typeof resolved.hooks.onLimitExceeded).toBe('function');
            expect(typeof resolved.hooks.onDowngrade).toBe('function');
            expect(typeof resolved.hooks.onOutputCapped).toBe('function');
            expect(typeof resolved.hooks.onLog).toBe('function');
            
            // No-op hooks should not throw when called
            expect(() => resolved.hooks.onLimitExceeded({ tokens: 100, inputCost: 0.01, outputCost: 0.02 })).not.toThrow();
            expect(() => resolved.hooks.onDowngrade('model-a', 'model-b', 0.005)).not.toThrow();
            expect(() => resolved.hooks.onOutputCapped(1000, 'budget limit')).not.toThrow();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve explicitly set values', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(100), noNaN: true }),
          fc.boolean(),
          fc.integer({ min: 1, max: 10000 }),
          fc.boolean(),
          fc.boolean(),
          (maxCost, autoDowngrade, minOutputTokens, strict, failOpen) => {
            const options: GramOptions = {
              maxCost,
              autoDowngrade,
              minOutputTokens,
              strict,
              failOpen,
            };
            const resolved = resolveConfig(options);
            
            expect(resolved.maxCost).toBe(maxCost);
            expect(resolved.autoDowngrade).toBe(autoDowngrade);
            expect(resolved.minOutputTokens).toBe(minOutputTokens);
            expect(resolved.strict).toBe(strict);
            expect(resolved.failOpen).toBe(failOpen);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 21: Configuration Validation**
   * **Validates: Requirements 10.5, 10.6, 10.7**
   * 
   * For any configuration with invalid values (non-positive maxCost, negative remainingBudget,
   * non-positive minOutputTokens), a GramConfigError should be thrown at wrap time.
   */
  describe('Property 21: Configuration Validation', () => {
    it('should throw GramConfigError for non-positive maxCost', () => {
      fc.assert(
        fc.property(
          fc.float({ min: -1000, max: 0, noNaN: true }),
          (maxCost) => {
            const options: GramOptions = { maxCost };
            
            expect(() => validateConfig(options)).toThrow(GramConfigError);
            
            try {
              validateConfig(options);
            } catch (error) {
              expect(error).toBeInstanceOf(GramConfigError);
              expect((error as GramConfigError).field).toBe('maxCost');
              expect((error as GramConfigError).reason).toBe('Must be a positive number');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should throw GramConfigError for negative remainingBudget', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(-1000), max: Math.fround(-0.000001), noNaN: true }),
          (remainingBudget) => {
            const options: GramOptions = { remainingBudget };
            
            expect(() => validateConfig(options)).toThrow(GramConfigError);
            
            try {
              validateConfig(options);
            } catch (error) {
              expect(error).toBeInstanceOf(GramConfigError);
              expect((error as GramConfigError).field).toBe('remainingBudget');
              expect((error as GramConfigError).reason).toBe('Cannot be negative');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should throw GramConfigError for non-positive minOutputTokens', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -1000, max: 0 }),
          (minOutputTokens) => {
            const options: GramOptions = { minOutputTokens };
            
            expect(() => validateConfig(options)).toThrow(GramConfigError);
            
            try {
              validateConfig(options);
            } catch (error) {
              expect(error).toBeInstanceOf(GramConfigError);
              expect((error as GramConfigError).field).toBe('minOutputTokens');
              expect((error as GramConfigError).reason).toBe('Must be a positive number');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not throw for valid configuration values', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.001), max: Math.fround(1000), noNaN: true }),
          fc.float({ min: Math.fround(0), max: Math.fround(1000), noNaN: true }),
          fc.integer({ min: 1, max: 10000 }),
          (maxCost, remainingBudget, minOutputTokens) => {
            const options: GramOptions = {
              maxCost,
              remainingBudget,
              minOutputTokens,
            };
            
            expect(() => validateConfig(options)).not.toThrow();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not throw when optional fields are undefined', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.boolean(),
          (autoDowngrade, failOpen) => {
            const options: GramOptions = {
              autoDowngrade,
              failOpen,
              // maxCost, remainingBudget, minOutputTokens are all undefined
            };
            
            expect(() => validateConfig(options)).not.toThrow();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow zero remainingBudget (edge case)', () => {
      const options: GramOptions = { remainingBudget: 0 };
      expect(() => validateConfig(options)).not.toThrow();
    });
  });
});
