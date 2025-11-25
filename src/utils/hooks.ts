/**
 * Safe hook invocation utilities for gram-middleware
 * 
 * Requirements: 7.5
 */

/**
 * Safely invokes a hook function, catching and logging any errors.
 * Hook errors are never propagated - they should never break the pipeline.
 * 
 * @param hook - The hook function to invoke
 * @param args - Arguments to pass to the hook
 * 
 * Requirements: 7.5
 */
export function safeInvokeHook<T extends (...args: any[]) => void>(
  hook: T,
  ...args: Parameters<T>
): void {
  try {
    hook(...args);
  } catch (error) {
    // Log but don't propagate - hooks should never break the pipeline
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Gram] Hook error: ${errorMessage}`);
  }
}

/**
 * Creates a safe version of a hook that catches and logs errors.
 * 
 * @param hook - The hook function to wrap
 * @returns A wrapped hook that catches errors
 * 
 * Requirements: 7.5
 */
export function createSafeHook<T extends (...args: any[]) => void>(
  hook: T
): T {
  return ((...args: Parameters<T>) => {
    safeInvokeHook(hook, ...args);
  }) as T;
}
