/**
 * LLM client for calling DeepInfra's OpenAI-compatible API
 */

import type { Env, LLMResponse, OpenAIRequest, OpenAIResponse, OpenAIUsage } from './types';

// Pricing per the Common Setup.md
const INPUT_COST_PER_MILLION = 0.03;
const OUTPUT_COST_PER_MILLION = 0.14;

/**
 * Calculate cost in USD based on token usage
 */
function calculateCost(usage: OpenAIUsage): number {
  const inputCost = (usage.prompt_tokens / 1_000_000) * INPUT_COST_PER_MILLION;
  const outputCost = (usage.completion_tokens / 1_000_000) * OUTPUT_COST_PER_MILLION;
  return inputCost + outputCost;
}

/**
 * Extract title from markdown description (first # header)
 */
function extractTitle(markdown: string): string {
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  return titleMatch?.[1]?.trim() || '';
}

/**
 * Extract summary (first ~400 characters of content)
 */
function extractSummary(markdown: string, maxLength: number = 400): string {
  const summary = markdown.slice(0, maxLength);
  return summary.length < markdown.length ? summary + '...' : summary;
}

/**
 * Call the LLM API with the given prompts
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  env: Env
): Promise<LLMResponse> {
  const requestBody: OpenAIRequest = {
    model: env.MODEL_NAME,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: env.MAX_TOKENS || 3072,
    temperature: 0.3
  };

  const response = await fetch(`${env.DEEPINFRA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.DEEPINFRA_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }

  const data: OpenAIResponse = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error('LLM API returned no choices');
  }

  const description = data.choices[0].message.content;

  return {
    description,
    title: extractTitle(description),
    summary: extractSummary(description),
    tokens: data.usage.total_tokens,
    prompt_tokens: data.usage.prompt_tokens,
    completion_tokens: data.usage.completion_tokens,
    cost_usd: calculateCost(data.usage),
    model: env.MODEL_NAME
  };
}
