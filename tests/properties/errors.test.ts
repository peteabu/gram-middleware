/**
 * Property-based tests for error class structure
 * 
 * **Feature: gram-middleware, Property 5: Strict Mode Blocking (error structure portion)**
 * **Feature: gram-middleware, Property 10: Exhausted Fallbacks Strict (error structure portion)**
 * **Validates: Requirements 4.4, 5.5, 12.1, 12.2**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  GramError,
  GramLimitError,
  GramDowngradeError,
  GramConfigError,
} from '../../src/errors.js';

describe('Error Class Structure Properties', () => {
  /**
   * **Feature: gram-middleware, Property 5: Strict Mode Blocking (error structure portion)**
   * **Validates: Requirements 4.4, 12.1**
   * 
   * For any GramLimitError, it should contain the estimated cost, maxCost, and model name.
   */
  describe('Property 5: GramLimitError Structure', () => {
    it('should contain estimatedCost, maxCost, and model fields for any valid inputs', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.000001), max: Math.fround(100), noNaN: true }),  // estimatedCost
          fc.float({ min: Math.fround(0.000001), max: Math.fround(100), noNaN: true }),  // maxCost
          fc.string({ minLength: 1, maxLength: 50 }),          // model name
          (estimatedCost, maxCost, model) => {
            const error = new GramLimitError(estimatedCost, maxCost, model);

            // Verify all required fields are present and correct
            expect(error.estimatedCost).toBe(estimatedCost);
            expect(error.maxCost).toBe(maxCost);
            expect(error.model).toBe(model);
            expect(error.name).toBe('GramLimitError');
            expect(error).toBeInstanceOf(GramError);
            expect(error).toBeInstanceOf(Error);
            
            // Verify message contains all relevant information
            expect(error.message).toContain(estimatedCost.toFixed(6));
            expect(error.message).toContain(maxCost.toFixed(6));
            expect(error.message).toContain(model);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 10: Exhausted Fallbacks Strict (error structure portion)**
   * **Validates: Requirements 5.5, 12.2**
   * 
   * For any GramDowngradeError, it should contain the original model and list of all attempted fallbacks.
   */
  describe('Property 10: GramDowngradeError Structure', () => {
    it('should contain originalModel, attemptedFallbacks, and reason for any valid inputs', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),                    // originalModel
          fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 10 }), // attemptedFallbacks
          fc.string({ minLength: 1, maxLength: 200 }),                   // reason
          (originalModel, attemptedFallbacks, reason) => {
            const error = new GramDowngradeError(originalModel, attemptedFallbacks, reason);

            // Verify all required fields are present and correct
            expect(error.originalModel).toBe(originalModel);
            expect(error.attemptedFallbacks).toEqual(attemptedFallbacks);
            expect(error.reason).toBe(reason);
            expect(error.name).toBe('GramDowngradeError');
            expect(error).toBeInstanceOf(GramError);
            expect(error).toBeInstanceOf(Error);
            
            // Verify message contains relevant information
            expect(error.message).toContain(originalModel);
            expect(error.message).toContain(reason);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 12.3**
   * 
   * GramConfigError should contain field and reason for configuration validation failures.
   */
  describe('GramConfigError Structure', () => {
    it('should contain field and reason for any valid inputs', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),   // field
          fc.string({ minLength: 1, maxLength: 200 }),  // reason
          (field, reason) => {
            const error = new GramConfigError(field, reason);

            // Verify all required fields are present and correct
            expect(error.field).toBe(field);
            expect(error.reason).toBe(reason);
            expect(error.name).toBe('GramConfigError');
            expect(error).toBeInstanceOf(GramError);
            expect(error).toBeInstanceOf(Error);
            
            // Verify message contains relevant information
            expect(error.message).toContain(field);
            expect(error.message).toContain(reason);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 12.1, 12.2, 12.3, 12.4**
   * 
   * All error classes should extend GramError base class.
   */
  describe('Error Hierarchy', () => {
    it('all error types should extend GramError', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.000001), max: Math.fround(100), noNaN: true }),
          fc.float({ min: Math.fround(0.000001), max: Math.fround(100), noNaN: true }),
          fc.string({ minLength: 1 }),
          fc.array(fc.string({ minLength: 1 })),
          fc.string({ minLength: 1 }),
          (cost1, cost2, str1, arr, str2) => {
            const limitError = new GramLimitError(cost1, cost2, str1);
            const downgradeError = new GramDowngradeError(str1, arr, str2);
            const configError = new GramConfigError(str1, str2);

            // All should be instances of GramError
            expect(limitError).toBeInstanceOf(GramError);
            expect(downgradeError).toBeInstanceOf(GramError);
            expect(configError).toBeInstanceOf(GramError);

            // All should be instances of Error
            expect(limitError).toBeInstanceOf(Error);
            expect(downgradeError).toBeInstanceOf(Error);
            expect(configError).toBeInstanceOf(Error);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
