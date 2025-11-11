/**
 * Prompt generation for the archivist LLM
 */

import type { SummarizeRequest, TextFile } from './types';

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
 */
function formatFiles(files: TextFile[]): string {
  if (files.length === 0) {
    return 'No content files provided for this directory.';
  }

  return files.map((file, index) => {
    // Truncate content to save tokens - focus on quality over quantity
    const maxLength = 800;
    const content = file.content.length > maxLength
      ? file.content.slice(0, maxLength) + '\n... [content truncated]'
      : file.content;

    return `File ${index + 1}: ${file.name}\n\n${content}`;
  }).join('\n\n---\n\n');
}

/**
 * Generate the complete user prompt
 */
export function generateUserPrompt(request: SummarizeRequest): string {
  const filesSection = `## Source Materials\n\n${formatFiles(request.files)}`;

  return `Directory: ${request.directory_name}

${filesSection}

Write a clear, factual description (200-350 words) of this archived item using the structure above. Describe what's here based on the source materials provided.`;
}
