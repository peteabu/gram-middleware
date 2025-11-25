# gram-middleware

A lightweight, drop-in wrapper for AI SDKs (OpenAI, Anthropic) that adds cost awareness, budget enforcement, and automatic optimization to every request.

## Features

- **Zero Code Changes**: Wrap your existing SDK client and use it exactly as before
- **Cost Estimation**: Automatically estimates costs before every request
- **Budget Enforcement**: Block requests that exceed your cost limits
- **Auto-Downgrade**: Automatically fall back to cheaper models when limits are exceeded
- **Output Capping**: Dynamically cap output tokens based on remaining budget
- **Fail-Safe**: Gracefully handles errors without breaking your application

## Installation

```bash
npm install gram-middleware gram-library
```

## Quick Start

```typescript
import OpenAI from 'openai';
import { withGram } from 'gram-middleware';

// Wrap your existing client
const openai = withGram(new OpenAI(), {
  maxCost: 0.10, // Maximum $0.10 per request
});

// Use exactly like the original client
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

## Configuration

### Basic Options

```typescript
const client = withGram(new OpenAI(), {
  // Cost limit per request (USD)
  maxCost: 0.10,
  
  // Automatically try cheaper models if over budget
  autoDowngrade: true,
  fallbackModels: ['gpt-4o-mini', 'gpt-3.5-turbo'],
  
  // Cap output tokens based on remaining budget
  remainingBudget: 1.00,
  minOutputTokens: 500, // Default: 500
  
  // Strict mode: throw errors vs. warn and proceed
  strict: true, // Default: true if maxCost is set
  
  // Fail-safe: proceed on middleware errors
  failOpen: true, // Default: true
});
```

### Event Hooks

```typescript
const client = withGram(new OpenAI(), {
  maxCost: 0.10,
  hooks: {
    // Called when a request exceeds cost limits
    onLimitExceeded: (estimate) => {
      console.warn(`Cost limit exceeded: $${estimate.inputCost.toFixed(6)}`);
    },
    
    // Called when a model is downgraded
    onDowngrade: (originalModel, newModel, savings) => {
      console.log(`Downgraded from ${originalModel} to ${newModel}, saving $${savings.toFixed(6)}`);
    },
    
    // Called when output tokens are capped
    onOutputCapped: (maxTokens, reason) => {
      console.log(`Output capped to ${maxTokens} tokens: ${reason}`);
    },
    
    // Custom logger (replaces console.log)
    onLog: (message) => {
      myLogger.info(message);
    },
  },
});
```

### Using a Custom Gram Instance

```typescript
import { Gram } from 'gram-library';

const gram = new Gram();

const client = withGram(new OpenAI(), {
  gram, // Use your own Gram instance
  maxCost: 0.10,
});
```

## Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `gram` | `Gram` | `new Gram()` | Custom Gram instance for cost estimation |
| `maxCost` | `number` | `undefined` | Maximum cost per request in USD |
| `autoDowngrade` | `boolean` | `false` | Enable automatic model downgrade |
| `fallbackModels` | `string[]` | `[]` | Ordered list of fallback models |
| `remainingBudget` | `number` | `undefined` | User's remaining budget for output capping |
| `minOutputTokens` | `number` | `500` | Threshold for output capping |
| `strict` | `boolean` | `true` if `maxCost` set | Throw errors vs. warn and proceed |
| `failOpen` | `boolean` | `true` | Proceed on middleware errors |
| `hooks` | `GramHooks` | `{}` | Event callbacks |



## Error Handling

gram-middleware provides typed errors for programmatic handling:

### GramLimitError

Thrown when a request exceeds the configured `maxCost` in strict mode.

```typescript
import { GramLimitError } from 'gram-middleware';

try {
  await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: veryLongPrompt }],
  });
} catch (error) {
  if (error instanceof GramLimitError) {
    console.log(`Estimated: $${error.estimatedCost}`);
    console.log(`Limit: $${error.maxCost}`);
    console.log(`Model: ${error.model}`);
  }
}
```

### GramDowngradeError

Thrown when auto-downgrade is enabled but all fallback models still exceed the cost limit.

```typescript
import { GramDowngradeError } from 'gram-middleware';

try {
  await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: veryLongPrompt }],
  });
} catch (error) {
  if (error instanceof GramDowngradeError) {
    console.log(`Original model: ${error.originalModel}`);
    console.log(`Tried: ${error.attemptedFallbacks.join(', ')}`);
    console.log(`Reason: ${error.reason}`);
  }
}
```

### GramConfigError

Thrown at wrap time when configuration is invalid.

```typescript
import { GramConfigError } from 'gram-middleware';

try {
  const client = withGram(new OpenAI(), {
    maxCost: -1, // Invalid!
  });
} catch (error) {
  if (error instanceof GramConfigError) {
    console.log(`Invalid field: ${error.field}`);
    console.log(`Reason: ${error.reason}`);
  }
}
```

## Supported Providers

- **OpenAI**: `chat.completions.create`
- **Anthropic**: `messages.create`

## Examples

### Budget Protection for SaaS

```typescript
// Per-user budget enforcement
async function handleUserRequest(userId: string, prompt: string) {
  const userBudget = await getUserRemainingBudget(userId);
  
  const openai = withGram(new OpenAI(), {
    remainingBudget: userBudget,
    minOutputTokens: 100,
    hooks: {
      onOutputCapped: (maxTokens) => {
        console.log(`User ${userId} output capped to ${maxTokens} tokens`);
      },
    },
  });
  
  return openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
  });
}
```

### Cost-Optimized Requests

```typescript
// Automatically use cheaper models for expensive requests
const openai = withGram(new OpenAI(), {
  maxCost: 0.05,
  autoDowngrade: true,
  fallbackModels: ['gpt-4o-mini', 'gpt-3.5-turbo'],
  hooks: {
    onDowngrade: (from, to, savings) => {
      metrics.recordDowngrade(from, to, savings);
    },
  },
});
```

### Lenient Mode with Logging

```typescript
// Warn but don't block over-budget requests
const openai = withGram(new OpenAI(), {
  maxCost: 0.10,
  strict: false, // Don't throw, just warn
  hooks: {
    onLimitExceeded: (estimate) => {
      alerting.warn('cost_exceeded', {
        cost: estimate.inputCost,
        tokens: estimate.tokens,
      });
    },
  },
});
```

## TypeScript Support

gram-middleware is written in TypeScript and exports all types:

```typescript
import type {
  GramOptions,
  GramHooks,
  CostEstimate,
  EvaluationResult,
  ResolvedConfig,
  ProviderAdapter,
} from 'gram-middleware';
```

## License

ISC
