/**
 * Main summarization logic
 */

import type { Env, SummarizeRequest, SummarizeResponse } from './types';
import { callLLM } from './llm';
import { generateSystemPrompt, generateUserPrompt } from './prompts';

/**
 * Extract metadata from the LLM response
 * The LLM is expected to include a JSON code block with metadata
 */
function extractMetadata(description: string): any {
  // Look for JSON code block in the markdown
  const jsonMatch = description.match(/```json\s*\n([\s\S]*?)\n```/);

  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch (e) {
      console.error('Failed to parse metadata JSON from LLM response:', e);
    }
  }

  // Fallback: return empty object if no metadata found
  return {};
}

/**
 * Remove metadata JSON block from description to keep it clean
 */
function cleanDescription(description: string): string {
  // Remove the JSON code block if present
  return description.replace(/```json\s*\n[\s\S]*?\n```/g, '').trim();
}

/**
 * Main function to generate description for a directory
 */
export async function generateDescription(
  request: SummarizeRequest,
  env: Env
): Promise<SummarizeResponse> {
  // Validate input
  if (!request.directory_name) {
    throw new Error('directory_name is required');
  }

  if (!Array.isArray(request.children_ocr)) {
    throw new Error('children_ocr must be an array');
  }

  if (!Array.isArray(request.children_descriptions)) {
    throw new Error('children_descriptions must be an array');
  }

  // Determine if this is a leaf node or aggregation node
  const hasChildDescriptions = request.children_descriptions.length > 0;

  // Generate prompts
  const systemPrompt = generateSystemPrompt(hasChildDescriptions);
  const userPrompt = generateUserPrompt(request);

  // Call LLM
  const llmResponse = await callLLM(systemPrompt, userPrompt, env);

  // Extract and clean metadata
  const metadata = extractMetadata(llmResponse.description);
  const cleanedDescription = cleanDescription(llmResponse.description);

  // Merge with manual metadata (manual metadata takes precedence)
  const finalMetadata = {
    ...metadata,
    ...request.manual_metadata
  };

  return {
    description: cleanedDescription,
    metadata: finalMetadata,
    cost_usd: llmResponse.cost_usd,
    tokens: llmResponse.tokens
  };
}
