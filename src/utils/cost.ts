/**
 * Cost calculation utilities for gram-middleware
 * 
 * Requirements: 6.1
 */

/**
 * Calculates the maximum affordable output tokens based on remaining budget.
 * 
 * Formula: (remainingBudget - inputCost) / (outputPrice / 1_000_000)
 * 
 * @param remainingBudget - The user's remaining budget in USD
 * @param inputCost - The estimated input cost in USD
 * @param outputPrice - The output price per 1M tokens in USD
 * @returns Integer (floor) of calculated tokens, or 0 if result is negative
 * 
 * Requirements: 6.1
 */
export function calculateMaxAffordableOutputTokens(
  remainingBudget: number,
  inputCost: number,
  outputPrice: number
): number {
  // Calculate available budget after input cost
  const availableBudget = remainingBudget - inputCost;
  
  // Handle edge case: no budget remaining
  if (availableBudget <= 0) {
    return 0;
  }
  
  // Handle edge case: zero or negative output price (shouldn't happen, but be safe)
  if (outputPrice <= 0) {
    return 0;
  }
  
  // Calculate: availableBudget / (outputPrice / 1_000_000)
  // Which is equivalent to: availableBudget * 1_000_000 / outputPrice
  const pricePerToken = outputPrice / 1_000_000;
  const maxTokens = availableBudget / pricePerToken;
  
  // Return floor of calculated tokens, ensuring non-negative
  return Math.max(0, Math.floor(maxTokens));
}
