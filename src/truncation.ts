/**
 * Progressive Tax Truncation Algorithm
 *
 * Implements a fair truncation strategy that protects small files while
 * proportionally reducing large files to fit within token budgets.
 *
 * See PROGRESSIVE-TAX-ALGORITHM.md for detailed explanation.
 */

import type { TextFile, TokenizedFile, TruncationConfig, TruncationResult } from './types';

/**
 * Estimate token count from character count
 * Uses a conservative 1 token ≈ 3 characters approximation
 * Standard is 4 chars/token for prose, but 3 is safer for varied/repetitive content
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * Estimate tokens for a formatted prompt string
 * Adds overhead for message structure
 */
export function estimatePromptTokens(prompt: string): number {
  // Base estimation + ~10 tokens for message formatting overhead
  return estimateTokens(prompt) + 10;
}

/**
 * Calculate available token budget for file contents
 */
export function calculateAvailableBudget(config: TruncationConfig): number {
  const {
    contextWindowTokens,
    maxOutputTokens,
    safetyMarginRatio,
    systemPromptTokens,
    userPromptTemplateTokens
  } = config;

  // Calculate raw available tokens
  const rawAvailable = contextWindowTokens - systemPromptTokens - userPromptTemplateTokens - maxOutputTokens;

  // Apply safety margin
  return Math.floor(rawAvailable * safetyMarginRatio);
}

/**
 * Truncate content to a specific character count
 */
function truncateContent(content: string, targetChars: number): string {
  if (content.length <= targetChars) {
    return content;
  }

  const truncated = content.slice(0, targetChars);
  return truncated + '\n... [content truncated]';
}

/**
 * Apply progressive tax truncation algorithm to a list of files
 *
 * This implements the algorithm from PROGRESSIVE-TAX-ALGORITHM.md:
 * 1. Calculate deficit (total tokens - target)
 * 2. Calculate average tax per item
 * 3. Split items into below-average (protected) and above-average groups
 * 4. Check if protection is feasible
 * 5. Either tax only above-average items (protection mode) or tax all proportionally (fallback)
 */
export function applyProgressiveTaxTruncation(
  files: TextFile[],
  targetTokens: number
): TruncationResult {
  // Convert files to tokenized format
  const tokenizedFiles: TokenizedFile[] = files.map(file => ({
    name: file.name,
    content: file.content,
    tokens: estimateTokens(file.content),
    originalTokens: estimateTokens(file.content)
  }));

  // Step 1: Calculate deficit
  const totalTokens = tokenizedFiles.reduce((sum, f) => sum + f.tokens, 0);
  const deficit = totalTokens - targetTokens;

  // If already under budget, return unchanged
  if (deficit <= 0) {
    return {
      files: tokenizedFiles,
      totalTokensBefore: totalTokens,
      totalTokensAfter: totalTokens,
      targetTokens,
      deficit: 0,
      protectionMode: false,
      filesProtected: 0,
      filesTruncated: 0
    };
  }

  // Step 2: Calculate average tax per item
  const averageTax = deficit / tokenizedFiles.length;

  // Step 3: Split into below-average and above-average groups
  const belowAverage = tokenizedFiles.filter(f => f.tokens < averageTax);
  const aboveAverage = tokenizedFiles.filter(f => f.tokens >= averageTax);

  // Step 4: Check if protection is feasible
  const totalBelow = belowAverage.reduce((sum, f) => sum + f.tokens, 0);
  const protectionFeasible = totalBelow <= targetTokens;

  let protectionMode = false;
  let filesProtected = 0;
  let filesTruncated = 0;

  if (protectionFeasible && aboveAverage.length > 0) {
    // Step 5: Protection Mode - tax only above-average items
    protectionMode = true;
    filesProtected = belowAverage.length;

    const totalAbove = aboveAverage.reduce((sum, f) => sum + f.tokens, 0);

    for (const file of aboveAverage) {
      const proportion = file.tokens / totalAbove;
      const tax = Math.ceil(proportion * deficit);
      const finalTokens = Math.max(0, file.tokens - tax);

      // Convert tokens back to characters (tokens * 3)
      const targetChars = finalTokens * 3;
      file.content = truncateContent(file.content, targetChars);
      file.tokens = finalTokens;
      filesTruncated++;
    }

    // Step 6: Below-average items keep everything (already unchanged)
  } else {
    // Step 7: Fallback Mode - everyone pays proportionally
    protectionMode = false;

    for (const file of tokenizedFiles) {
      const proportion = file.tokens / totalTokens;
      const tax = Math.ceil(proportion * deficit);
      const finalTokens = Math.max(0, file.tokens - tax);

      // Convert tokens back to characters (tokens * 3)
      const targetChars = finalTokens * 3;
      file.content = truncateContent(file.content, targetChars);
      file.tokens = finalTokens;
      filesTruncated++;
    }
  }

  const totalTokensAfter = tokenizedFiles.reduce((sum, f) => sum + f.tokens, 0);

  return {
    files: tokenizedFiles,
    totalTokensBefore: totalTokens,
    totalTokensAfter,
    targetTokens,
    deficit,
    protectionMode,
    filesProtected,
    filesTruncated
  };
}

/**
 * Main entry point for truncating files to fit token budget
 */
export function truncateFilesToBudget(
  files: TextFile[],
  config: TruncationConfig
): TruncationResult {
  const availableBudget = calculateAvailableBudget(config);
  return applyProgressiveTaxTruncation(files, availableBudget);
}
