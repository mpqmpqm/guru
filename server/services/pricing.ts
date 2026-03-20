/**
 * Model pricing configuration and cost calculation.
 * Prices are in USD per million tokens unless noted otherwise.
 *
 * OpenAI rates were rechecked against official model docs in March 2026.
 */

const DEFAULT_PRICING_MODEL = "gpt-5-mini";

export interface Usage {
  cached_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  reasoning_tokens?: number | null;
}

interface ModelPricing {
  cachedInput?: number;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite5m?: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.4": {
    input: 2.5,
    cachedInput: 0.25,
    output: 10.0,
  },
  "gpt-5-mini": {
    input: 0.25,
    cachedInput: 0.025,
    output: 2.0,
  },
  "gpt-5-nano": {
    input: 0.05,
    cachedInput: 0.005,
    output: 0.4,
  },
  "claude-opus-4-5": {
    input: 5.0,
    output: 25.0,
    cacheRead: 0.5,
    cacheWrite5m: 6.25,
  },
  "claude-sonnet-4-5": {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheWrite5m: 3.75,
  },
  "claude-haiku-4-5": {
    input: 1.0,
    output: 5.0,
    cacheRead: 0.1,
    cacheWrite5m: 1.25,
  },
};

export function calculateCost(
  usage: Usage,
  model: string = DEFAULT_PRICING_MODEL
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    throw new Error(`Unknown model: ${model}`);
  }

  const cachedInputTokens = usage.cached_input_tokens ?? 0;
  const uncachedInputTokens = Math.max(
    (usage.input_tokens ?? 0) - cachedInputTokens,
    0
  );
  const inputCost =
    (uncachedInputTokens / 1_000_000) * pricing.input;
  const outputCost =
    ((usage.output_tokens ?? 0) / 1_000_000) * pricing.output;

  const cacheReadTokens =
    usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? 0;
  const cacheReadRate =
    pricing.cachedInput ?? pricing.cacheRead ?? 0;
  const cacheReadCost =
    (cacheReadTokens / 1_000_000) * cacheReadRate;

  const cacheWriteCost =
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) *
    (pricing.cacheWrite5m ?? 0);

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `${cost.toFixed(4)}`;
  }
  return `${cost.toFixed(2)}`;
}

/**
 * TTS pricing for gpt-4o-mini-tts.
 * Empirically validated rate: $0.037 per 1K input tokens.
 */
export const TTS_COST_PER_1K_TOKENS = 0.037;

export function calculateTTSCost(inputTokens: number): number {
  return (inputTokens / 1000) * TTS_COST_PER_1K_TOKENS;
}
