/**
 * Main summarization logic
 */

import type { Env, SummarizeRequest, SummarizeResponse } from './types';
import { callLLM } from './llm';
import { generateSystemPrompt, generateUserPrompt } from './prompts';

/**
 * Main function to generate wiki-style description for a directory
 */
export async function generateDescription(
  request: SummarizeRequest,
  env: Env
): Promise<SummarizeResponse> {
  // Validate input
  if (!request.directory_name) {
    throw new Error('directory_name is required');
  }

  if (!Array.isArray(request.files)) {
    throw new Error('files must be an array');
  }

  // Generate prompts
  const systemPrompt = generateSystemPrompt();
  const userPrompt = generateUserPrompt(request);

  // Call LLM
  const llmResponse = await callLLM(systemPrompt, userPrompt, env);

  return {
    description: llmResponse.description
  };
}
