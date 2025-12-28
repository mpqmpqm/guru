/**
 * Anthropic model pricing configuration and cost calculation.
 * Prices in USD per million tokens.
 *
 * Last updated: 2025-12-28
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 */

import type { BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export type Usage = BetaUsage;

interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-5": {
    input: 5.0,
    output: 25.0,
    cacheRead: 0.5,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10.0,
  },
  "claude-sonnet-4-5": {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
  },
  "claude-haiku-4-5": {
    input: 1.0,
    output: 5.0,
    cacheRead: 0.1,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2.0,
  },
};

/**
 * Calculate cost in USD from usage data.
 * Extended thinking tokens are included in output_tokens.
 * Assumes 5-minute cache TTL (Agent SDK default).
 */
export function calculateCost(
  usage: Usage,
  model: string = "claude-opus-4-5"
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    throw new Error(`Unknown model: ${model}`);
  }

  const inputCost =
    ((usage.input_tokens ?? 0) / 1_000_000) * pricing.input;

  const outputCost =
    ((usage.output_tokens ?? 0) / 1_000_000) * pricing.output;

  const cacheReadCost =
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * pricing.cacheRead;

  const cacheWriteCost =
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) *
    pricing.cacheWrite5m;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

/**
 * Format cost as USD string.
 */
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
