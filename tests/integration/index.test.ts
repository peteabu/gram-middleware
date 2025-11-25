/**
 * Integration tests for gram-middleware main wrapper
 * 
 * Tests end-to-end flow with mocked SDK clients
 * 
 * **Validates: Requirements 1.1, 9.1, 9.4**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Gram } from 'gram-library';
import { withGram, GramLimitError, GramConfigError } from '../../src/index.js';

/**
 * Creates a mock Gram instance
 */
function createMockGram(options: {
  estimateResult?: { tokens: number; inputCost: number; outputCost: number };
  modelProvider?: string;
} = {}): Gram {
  return {
    estimate: vi.fn().mockReturnValue(
      options.estimateResult ?? { tokens: 100, inputCost: 0.001, outputCost: 0.002 }
    ),
    countTokens: vi.fn().mockResolvedValue(50),
    getModel: vi.fn().mockReturnValue({ 
      provider: options.modelProvider ?? 'openai', 
      inputPrice: 0.01, 
      outputPrice: 0.03 
    }),
  } as unknown as Gram;
}

/**
 * Creates a mock OpenAI-like client
 */
function createMockOpenAIClient(response: unknown = { id: 'test', choices: [{ message: { content: 'Hello!' } }] }) {
  const createFn = vi.fn().mockResolvedValue(response);
  return {
    chat: {
      completions: {
        create: createFn,
      },
    },
    _createFn: createFn,
  };
}

/**
 * Creates a mock Anthropic-like client
 */
function createMockAnthropicClient(response: unknown = { id: 'test', content: [{ text: 'Hello!' }] }) {
  const createFn = vi.fn().mockResolvedValue(response);
  return {
    messages: {
      create: createFn,
    },
    _createFn: createFn,
  };
}

describe('withGram Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('OpenAI Client Wrapping', () => {
    it('should wrap OpenAI client and maintain interface', async () => {
      const mockClient = createMockOpenAIClient();
      const mockGram = createMockGram();
      
      const wrapped = withGram(mockClient, { gram: mockGram });
      
      // Should have same structure
      expect(wrapped.chat).toBeDefined();
      expect(wrapped.chat.completions).toBeDefined();
      expect(typeof wrapped.chat.completions.create).toBe('function');
    });

    it('should intercept and execute OpenAI requests', async () => {
      const expectedResponse = { id: 'resp-1', choices: [{ message: { content: 'Test response' } }] };
      const mockClient = createMockOpenAIClient(expectedResponse);
      const mockGram = createMockGram();
      
      const wrapped = withGram(mockClient, { gram: mockGram });
      
      const response = await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      
      // Should return the response unchanged
      expect(response).toEqual(expectedResponse);
      
      // Should have called the original method
      expect(mockClient._createFn).toHaveBeenCalledTimes(1);
      
      // Should have called gram.estimate
      expect(mockGram.estimate).toHaveBeenCalled();
    });

    it('should block requests exceeding maxCost in strict mode', async () => {
      const mockClient = createMockOpenAIClient();
      const mockGram = createMockGram({
        estimateResult: { tokens: 1000, inputCost: 0.50, outputCost: 0.001 },
      });
      
      const wrapped = withGram(mockClient, {
        gram: mockGram,
        maxCost: 0.10,
        strict: true,
      });
      
      await expect(
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow(GramLimitError);
      
      // Should NOT have called the original method
      expect(mockClient._createFn).not.toHaveBeenCalled();
    });

    it('should proceed with requests under maxCost', async () => {
      const mockClient = createMockOpenAIClient();
      const mockGram = createMockGram({
        estimateResult: { tokens: 100, inputCost: 0.01, outputCost: 0.001 },
      });
      
      const wrapped = withGram(mockClient, {
        gram: mockGram,
        maxCost: 0.10,
        strict: true,
      });
      
      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      
      // Should have called the original method
      expect(mockClient._createFn).toHaveBeenCalledTimes(1);
    });

    it('should call onLimitExceeded hook in lenient mode', async () => {
      const mockClient = createMockOpenAIClient();
      const mockGram = createMockGram({
        estimateResult: { tokens: 1000, inputCost: 0.50, outputCost: 0.001 },
      });
      
      const onLimitExceeded = vi.fn();
      
      const wrapped = withGram(mockClient, {
        gram: mockGram,
        maxCost: 0.10,
        strict: false,
        hooks: { onLimitExceeded },
      });
      
      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      
      // Should have called the hook
      expect(onLimitExceeded).toHaveBeenCalledTimes(1);
      
      // Should have proceeded with the request
      expect(mockClient._createFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Anthropic Client Wrapping', () => {
    it('should wrap Anthropic client and maintain interface', async () => {
      const mockClient = createMockAnthropicClient();
      const mockGram = createMockGram({ modelProvider: 'anthropic' });
      
      const wrapped = withGram(mockClient, { gram: mockGram });
      
      // Should have same structure
      expect(wrapped.messages).toBeDefined();
      expect(typeof wrapped.messages.create).toBe('function');
    });

    it('should intercept and execute Anthropic requests', async () => {
      const expectedResponse = { id: 'msg-1', content: [{ text: 'Test response' }] };
      const mockClient = createMockAnthropicClient(expectedResponse);
      const mockGram = createMockGram({ modelProvider: 'anthropic' });
      
      const wrapped = withGram(mockClient, { gram: mockGram });
      
      const response = await wrapped.messages.create({
        model: 'claude-3-opus',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      
      // Should return the response unchanged
      expect(response).toEqual(expectedResponse);
      
      // Should have called the original method
      expect(mockClient._createFn).toHaveBeenCalledTimes(1);
    });

    it('should block Anthropic requests exceeding maxCost', async () => {
      const mockClient = createMockAnthropicClient();
      const mockGram = createMockGram({
        estimateResult: { tokens: 1000, inputCost: 0.50, outputCost: 0.001 },
        modelProvider: 'anthropic',
      });
      
      const wrapped = withGram(mockClient, {
        gram: mockGram,
        maxCost: 0.10,
        strict: true,
      });
      
      await expect(
        wrapped.messages.create({
          model: 'claude-3-opus',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow(GramLimitError);
    });
  });

  describe('Configuration Validation', () => {
    it('should throw GramConfigError for unsupported SDK', () => {
      const unsupportedClient = { someOtherMethod: () => {} };
      
      expect(() => withGram(unsupportedClient)).toThrow(GramConfigError);
    });

    it('should throw GramConfigError for invalid maxCost', () => {
      const mockClient = createMockOpenAIClient();
      
      expect(() => withGram(mockClient, { maxCost: -1 })).toThrow(GramConfigError);
      expect(() => withGram(mockClient, { maxCost: 0 })).toThrow(GramConfigError);
    });

    it('should throw GramConfigError for invalid remainingBudget', () => {
      const mockClient = createMockOpenAIClient();
      
      expect(() => withGram(mockClient, { remainingBudget: -1 })).toThrow(GramConfigError);
    });

    it('should throw GramConfigError for invalid minOutputTokens', () => {
      const mockClient = createMockOpenAIClient();
      
      expect(() => withGram(mockClient, { minOutputTokens: 0 })).toThrow(GramConfigError);
      expect(() => withGram(mockClient, { minOutputTokens: -100 })).toThrow(GramConfigError);
    });

    it('should log warning when autoDowngrade enabled without fallbackModels', () => {
      const mockClient = createMockOpenAIClient();
      const mockGram = createMockGram();
      const logMessages: string[] = [];
      
      withGram(mockClient, {
        gram: mockGram,
        autoDowngrade: true,
        hooks: { onLog: (msg) => logMessages.push(msg) },
      });
      
      expect(logMessages.some(msg => msg.includes('Warning') && msg.includes('autoDowngrade'))).toBe(true);
    });
  });

  describe('Argument Immutability', () => {
    it('should not mutate original arguments', async () => {
      const mockClient = createMockOpenAIClient();
      const mockGram = createMockGram();
      
      const wrapped = withGram(mockClient, { gram: mockGram });
      
      const originalArgs = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      const argsCopy = JSON.parse(JSON.stringify(originalArgs));
      
      await wrapped.chat.completions.create(originalArgs);
      
      // Original args should be unchanged
      expect(originalArgs).toEqual(argsCopy);
    });
  });

  describe('Streaming Response Handling', () => {
    it('should handle streaming responses', async () => {
      // Create an async generator for streaming
      async function* mockStream() {
        yield { choices: [{ delta: { content: 'Hello' } }] };
        yield { choices: [{ delta: { content: ' World' } }] };
        yield { choices: [{ delta: { content: '!' } }] };
      }
      
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockStream()),
          },
        },
      };
      const mockGram = createMockGram();
      
      const wrapped = withGram(mockClient, { gram: mockGram });
      
      const stream = await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      });
      
      // Collect streamed chunks
      const chunks: unknown[] = [];
      for await (const chunk of stream as AsyncIterable<unknown>) {
        chunks.push(chunk);
      }
      
      expect(chunks.length).toBe(3);
    });
  });

  describe('Error Propagation', () => {
    it('should propagate SDK errors unchanged', async () => {
      const sdkError = new Error('API rate limit exceeded');
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(sdkError),
          },
        },
      };
      const mockGram = createMockGram();
      
      const wrapped = withGram(mockClient, { gram: mockGram });
      
      await expect(
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow(sdkError);
    });
  });

  describe('Default Configuration', () => {
    it('should use default configuration when no options provided', async () => {
      const mockClient = createMockOpenAIClient();
      // Note: This will use a real Gram instance, which may fail
      // In a real test, we'd mock the Gram constructor
      
      // Just verify it doesn't throw during wrapping
      expect(() => withGram(mockClient)).not.toThrow();
    });

    it('should default strict to true when maxCost is set', async () => {
      const mockClient = createMockOpenAIClient();
      const mockGram = createMockGram({
        estimateResult: { tokens: 1000, inputCost: 0.50, outputCost: 0.001 },
      });
      
      const wrapped = withGram(mockClient, {
        gram: mockGram,
        maxCost: 0.10,
        // strict not explicitly set - should default to true
      });
      
      // Should throw because strict defaults to true when maxCost is set
      await expect(
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow(GramLimitError);
    });

    it('should default strict to false when maxCost is not set', async () => {
      const mockClient = createMockOpenAIClient();
      const mockGram = createMockGram({
        estimateResult: { tokens: 1000, inputCost: 0.50, outputCost: 0.001 },
      });
      
      const wrapped = withGram(mockClient, {
        gram: mockGram,
        // No maxCost - strict should default to false
      });
      
      // Should not throw - no cost limit configured
      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      });
    });
  });
});
