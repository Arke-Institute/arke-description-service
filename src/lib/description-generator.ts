/**
 * Generate description using LLM with retry
 */

import { Env, DescriptionContext } from '../types';
import { generateSystemPrompt, generateUserPrompt } from '../prompts';
import { callLLM } from '../llm';
import { withRetry } from './retry';

/**
 * Generate a description for the given context
 */
export async function generateDescription(
  context: DescriptionContext,
  customPrompt: string | undefined,
  env: Env
): Promise<string> {
  const maxRetries = parseInt(env.MAX_RETRIES_PER_PI || '3');

  // Convert context to the format expected by existing prompt generators
  const request = {
    directory_name: context.directory_name,
    files: context.files.map((f) => ({ name: f.filename, content: f.content })),
    custom_prompt: customPrompt,
  };

  // Generate prompts using existing logic (includes truncation)
  const systemPrompt = generateSystemPrompt(customPrompt);
  const userPrompt = generateUserPrompt(request, env);

  // Call LLM with retry
  const result = await withRetry(() => callLLM(systemPrompt, userPrompt, env), {
    maxRetries,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  });

  return result.description;
}
