/**
 * Type declarations for gram-library
 * 
 * gram-library is the underlying library that provides token counting
 * and cost estimation for AI models.
 */

declare module 'gram-library' {
  export interface EstimateResult {
    tokens: number;
    inputCost: number;
    outputCost: number;
  }

  export interface ModelData {
    provider: string;
    inputPrice: number;
    outputPrice: number;
  }

  export class Gram {
    constructor();
    
    /**
     * Estimates the cost of a request based on messages and model
     */
    estimate(messages: unknown[], model: string): EstimateResult;
    
    /**
     * Counts tokens for the given text and model
     */
    countTokens(text: string, model: string): Promise<number>;
    
    /**
     * Gets model data including provider and pricing
     */
    getModel(model: string): ModelData | undefined;
  }
}
