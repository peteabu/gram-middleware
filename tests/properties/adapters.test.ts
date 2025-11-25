/**
 * Property-based tests for provider adapters
 * 
 * **Feature: gram-middleware, Property 1: Interface Preservation**
 * **Feature: gram-middleware, Property 12: Cross-Provider Fallback Skip**
 * **Validates: Requirements 1.1, 5.8**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OpenAIAdapter } from '../../src/adapters/openai.js';
import { AnthropicAdapter } from '../../src/adapters/anthropic.js';
import { detectProvider, isModelForProvider } from '../../src/adapters/index.js';
import { GramConfigError } from '../../src/errors.js';
import type { ProviderAdapter } from '../../src/adapters/base.js';

// Mock clients for testing
const createMockOpenAIClient = () => ({
  chat: {
    completions: {
      create: async () => ({ id: 'test', choices: [] }),
    },
  },
});

const createMockAnthropicClient = () => ({
  messages: {
    create: async () => ({ id: 'test', content: [] }),
  },
});

// Mock Gram for isModelForProvider tests
const createMockGram = (modelProviderMap: Record<string, string>) => ({
  getModel: (model: string) => {
    const provider = modelProviderMap[model];
    if (!provider) return undefined;
    return { provider, inputPrice: 0.001, outputPrice: 0.002 };
  },
  estimate: () => ({ tokens: 100, inputCost: 0.01, outputCost: 0.02 }),
  countTokens: async () => 100,
});

describe('Adapter Properties', () => {
  /**
   * **Feature: gram-middleware, Property 1: Interface Preservation**
   * **Validates: Requirements 1.1**
   * 
   * For any supported SDK client, wrapping it with withGram() should return an object
   * that has the same callable methods as the original client.
   * 
   * This test validates that adapters correctly identify and preserve SDK structure.
   */
  describe('Property 1: Interface Preservation', () => {
    const openaiAdapter = new OpenAIAdapter();
    const anthropicAdapter = new AnthropicAdapter();

    it('OpenAI adapter should correctly identify OpenAI clients', () => {
      fc.assert(
        fc.property(
          fc.constant(createMockOpenAIClient()),
          (client) => {
            expect(openaiAdapter.isSupported(client)).toBe(true);
            expect(anthropicAdapter.isSupported(client)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Anthropic adapter should correctly identify Anthropic clients', () => {
      fc.assert(
        fc.property(
          fc.constant(createMockAnthropicClient()),
          (client) => {
            expect(anthropicAdapter.isSupported(client)).toBe(true);
            expect(openaiAdapter.isSupported(client)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('OpenAI adapter should intercept correct path', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
          (randomPath) => {
            const correctPath = ['chat', 'completions', 'create'];
            
            // Correct path should be intercepted
            expect(openaiAdapter.shouldIntercept(correctPath)).toBe(true);
            
            // Random paths should not be intercepted (unless they happen to match)
            const isCorrect = 
              randomPath.length === 3 &&
              randomPath[0] === 'chat' &&
              randomPath[1] === 'completions' &&
              randomPath[2] === 'create';
            expect(openaiAdapter.shouldIntercept(randomPath)).toBe(isCorrect);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Anthropic adapter should intercept correct path', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
          (randomPath) => {
            const correctPath = ['messages', 'create'];
            
            // Correct path should be intercepted
            expect(anthropicAdapter.shouldIntercept(correctPath)).toBe(true);
            
            // Random paths should not be intercepted (unless they happen to match)
            const isCorrect = 
              randomPath.length === 2 &&
              randomPath[0] === 'messages' &&
              randomPath[1] === 'create';
            expect(anthropicAdapter.shouldIntercept(randomPath)).toBe(isCorrect);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('adapters should preserve model when extracting and setting', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (originalModel, newModel) => {
            const args = { model: originalModel, messages: [] };
            
            // Test OpenAI adapter
            expect(openaiAdapter.extractModel(args)).toBe(originalModel);
            const modifiedOpenAI = openaiAdapter.setModel(args, newModel) as { model: string };
            expect(modifiedOpenAI.model).toBe(newModel);
            
            // Test Anthropic adapter
            expect(anthropicAdapter.extractModel(args)).toBe(originalModel);
            const modifiedAnthropic = anthropicAdapter.setModel(args, newModel) as { model: string };
            expect(modifiedAnthropic.model).toBe(newModel);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('adapters should preserve max_tokens when extracting and setting', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100000 }),
          fc.integer({ min: 1, max: 100000 }),
          (originalMaxTokens, newMaxTokens) => {
            const args = { model: 'test', messages: [], max_tokens: originalMaxTokens };
            
            // Test OpenAI adapter
            expect(openaiAdapter.getMaxTokens(args)).toBe(originalMaxTokens);
            const modifiedOpenAI = openaiAdapter.setMaxTokens(args, newMaxTokens) as { max_tokens: number };
            expect(modifiedOpenAI.max_tokens).toBe(newMaxTokens);
            
            // Test Anthropic adapter
            expect(anthropicAdapter.getMaxTokens(args)).toBe(originalMaxTokens);
            const modifiedAnthropic = anthropicAdapter.setMaxTokens(args, newMaxTokens) as { max_tokens: number };
            expect(modifiedAnthropic.max_tokens).toBe(newMaxTokens);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('adapters should correctly detect streaming mode', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          (stream) => {
            const args = { model: 'test', messages: [], stream };
            
            expect(openaiAdapter.isStreaming(args)).toBe(stream);
            expect(anthropicAdapter.isStreaming(args)).toBe(stream);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('adapters should extract messages correctly', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              role: fc.constantFrom('user', 'assistant', 'system'),
              content: fc.string({ minLength: 0, maxLength: 100 }),
            }),
            { minLength: 0, maxLength: 10 }
          ),
          (messages) => {
            const args = { model: 'test', messages };
            
            expect(openaiAdapter.extractMessages(args)).toEqual(messages);
            expect(anthropicAdapter.extractMessages(args)).toEqual(messages);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('setModel should not mutate original args', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (originalModel, newModel) => {
            const args = { model: originalModel, messages: [] };
            const originalArgs = { ...args };
            
            openaiAdapter.setModel(args, newModel);
            anthropicAdapter.setModel(args, newModel);
            
            // Original args should be unchanged
            expect(args).toEqual(originalArgs);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('setMaxTokens should not mutate original args', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100000 }),
          fc.integer({ min: 1, max: 100000 }),
          (originalMaxTokens, newMaxTokens) => {
            const args = { model: 'test', messages: [], max_tokens: originalMaxTokens };
            const originalArgs = { ...args };
            
            openaiAdapter.setMaxTokens(args, newMaxTokens);
            anthropicAdapter.setMaxTokens(args, newMaxTokens);
            
            // Original args should be unchanged
            expect(args).toEqual(originalArgs);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: gram-middleware, Property 12: Cross-Provider Fallback Skip**
   * **Validates: Requirements 5.8**
   * 
   * For any fallback model that belongs to a different provider than the wrapped SDK,
   * that model should be skipped during fallback iteration.
   */
  describe('Property 12: Cross-Provider Fallback Skip', () => {
    it('isModelForProvider should return true only for matching provider', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }),
          fc.constantFrom('openai', 'anthropic', 'google', 'mistral'),
          fc.constantFrom('openai', 'anthropic', 'google', 'mistral'),
          (modelName, modelProvider, queryProvider) => {
            const mockGram = createMockGram({ [modelName]: modelProvider });
            
            const result = isModelForProvider(modelName, queryProvider, mockGram as any);
            
            expect(result).toBe(modelProvider === queryProvider);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('isModelForProvider should return false for unknown models', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }),
          fc.constantFrom('openai', 'anthropic'),
          (modelName, provider) => {
            // Empty model map - no models known
            const mockGram = createMockGram({});
            
            const result = isModelForProvider(modelName, provider, mockGram as any);
            
            expect(result).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('detectProvider should throw GramConfigError for unsupported clients', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.constant({}),
            fc.constant({ someOther: 'property' }),
            fc.constant({ chat: null }),
            fc.constant({ messages: null }),
          ),
          (unsupportedClient) => {
            expect(() => detectProvider(unsupportedClient)).toThrow(GramConfigError);
            
            try {
              detectProvider(unsupportedClient);
            } catch (error) {
              expect(error).toBeInstanceOf(GramConfigError);
              expect((error as GramConfigError).field).toBe('client');
              expect((error as GramConfigError).reason).toContain('Unsupported SDK');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('detectProvider should return correct adapter for supported clients', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          (useOpenAI) => {
            const client = useOpenAI ? createMockOpenAIClient() : createMockAnthropicClient();
            const adapter = detectProvider(client);
            
            expect(adapter.provider).toBe(useOpenAI ? 'openai' : 'anthropic');
            expect(adapter.isSupported(client)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('OpenAI Stream Delta Extraction', () => {
    const adapter = new OpenAIAdapter();

    it('should extract content from valid stream chunks', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          (content) => {
            const chunk = {
              choices: [{ delta: { content } }],
            };
            
            expect(adapter.extractStreamDelta(chunk)).toBe(content);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null for chunks without content', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant({}),
            fc.constant({ choices: [] }),
            fc.constant({ choices: [{}] }),
            fc.constant({ choices: [{ delta: {} }] }),
            fc.constant({ choices: [{ delta: { content: null } }] }),
          ),
          (chunk) => {
            expect(adapter.extractStreamDelta(chunk)).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Anthropic Stream Delta Extraction', () => {
    const adapter = new AnthropicAdapter();

    it('should extract text from content_block_delta events', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          (text) => {
            const chunk = {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text },
            };
            
            expect(adapter.extractStreamDelta(chunk)).toBe(text);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null for non-content_block_delta events', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant({}),
            fc.constant({ type: 'message_start' }),
            fc.constant({ type: 'content_block_start' }),
            fc.constant({ type: 'message_delta' }),
            fc.constant({ type: 'content_block_delta', delta: {} }),
            fc.constant({ type: 'content_block_delta', delta: { type: 'other' } }),
          ),
          (chunk) => {
            expect(adapter.extractStreamDelta(chunk)).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Adapter Null/Undefined Handling', () => {
    const openaiAdapter = new OpenAIAdapter();
    const anthropicAdapter = new AnthropicAdapter();

    it('adapters should handle undefined max_tokens', () => {
      const args = { model: 'test', messages: [] };
      
      expect(openaiAdapter.getMaxTokens(args)).toBeUndefined();
      expect(anthropicAdapter.getMaxTokens(args)).toBeUndefined();
    });

    it('adapters should handle undefined stream', () => {
      const args = { model: 'test', messages: [] };
      
      expect(openaiAdapter.isStreaming(args)).toBe(false);
      expect(anthropicAdapter.isStreaming(args)).toBe(false);
    });

    it('isSupported should return false for non-object inputs', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.string(),
            fc.integer(),
            fc.boolean(),
          ),
          (input) => {
            expect(openaiAdapter.isSupported(input)).toBe(false);
            expect(anthropicAdapter.isSupported(input)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
