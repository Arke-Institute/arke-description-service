/**
 * Prompt generation for the archivist LLM
 */

import type { Env, SummarizeRequest, TextFile, TokenizedFile } from './types';
import { estimatePromptTokens, truncateFilesToBudget } from './truncation';

/**
 * Generate system prompt for the archivist role
 */
export function generateSystemPrompt(): string {
  return `You are an archivist writing clear, factual descriptions of archived materials to help people discover and understand collections.

Write encyclopedia-style descriptions that:
- Describe what the materials contain and cover
- Provide relevant context from the source materials (dates, places, people, institutions)
- Organize information clearly with sections
- Stay objective and factual
- Are concise (aim for 200-350 words)

Use this structure:
# [Title]
## Overview - What this is (form, dates, scope)
## Background - Relevant context about creation/provenance
## Contents - What's in it, key subjects and details
## Scope - Coverage (dates, geography, topics, what's included/excluded)

Write like a library catalog or encyclopedia entry—clear, accurate, neutral.`;
}

/**
 * Format files for inclusion in the user prompt
 * Files are already truncated by the progressive tax algorithm
 */
function formatFiles(files: TokenizedFile[]): string {
  if (files.length === 0) {
    return 'No content files provided for this directory.';
  }

  return files.map((file, index) => {
    return `File ${index + 1}: ${file.name}\n\n${file.content}`;
  }).join('\n\n---\n\n');
}

/**
 * Generate the complete user prompt with intelligent truncation
 */
export function generateUserPrompt(request: SummarizeRequest, env: Env): string {
  // Default configuration values
  const contextWindowTokens = env.CONTEXT_WINDOW_TOKENS || 131000;
  const maxOutputTokens = env.MAX_TOKENS || 3072;
  const safetyMarginRatio = env.SAFETY_MARGIN_RATIO || 0.7;

  // Calculate token counts for prompts
  const systemPrompt = generateSystemPrompt();
  const systemPromptTokens = estimatePromptTokens(systemPrompt);

  // Estimate user prompt template tokens (without file content)
  const userPromptTemplate = `Directory: ${request.directory_name}

## Source Materials

[FILE_CONTENT_PLACEHOLDER]

Write a clear, factual description (200-350 words) of this archived item using the structure above. Describe what's here based on the source materials provided.`;
  const userPromptTemplateTokens = estimatePromptTokens(userPromptTemplate);

  // Apply progressive tax truncation to files
  const truncationResult = truncateFilesToBudget(request.files, {
    contextWindowTokens,
    maxOutputTokens,
    safetyMarginRatio,
    systemPromptTokens,
    userPromptTemplateTokens
  });

  // Log truncation stats (visible in Cloudflare Workers logs)
  console.log('Progressive Tax Truncation:', {
    totalFiles: request.files.length,
    tokensBefore: truncationResult.totalTokensBefore,
    tokensAfter: truncationResult.totalTokensAfter,
    targetTokens: truncationResult.targetTokens,
    deficit: truncationResult.deficit,
    protectionMode: truncationResult.protectionMode,
    filesProtected: truncationResult.filesProtected,
    filesTruncated: truncationResult.filesTruncated
  });

  // Format files with truncated content
  const filesSection = `## Source Materials\n\n${formatFiles(truncationResult.files)}`;

  return `Directory: ${request.directory_name}

${filesSection}

Write a clear, factual description (200-350 words) of this archived item using the structure above. Describe what's here based on the source materials provided.`;
}
