/**
 * Prompt generation for the archivist LLM
 */

import type { SummarizeRequest, TextFile } from './types';

/**
 * Generate system prompt for the archivist role
 */
export function generateSystemPrompt(): string {
  return `You are an archivist creating wiki-style documentation for a historical photo collection. You are examining a directory with various text files containing information.

Your task is to:
1. Analyze all provided text files (which may be in various formats: JSON, XML, TXT, Markdown, CSV, etc.)
2. Synthesize information from all sources into a coherent understanding
3. Generate comprehensive wiki-style markdown documentation

Format your response as a rich markdown document with:
- A clear, descriptive title (# Header)
- Well-organized sections with subheadings (##, ###)
- Tables for structured information when appropriate
- Lists for enumerating items, people, locations, dates, etc.
- Contextual narrative that tells the story of the collection
- Historical background and significance where relevant
- Cross-references and connections between different elements

Write in an encyclopedic, informative style similar to Wikipedia articles. Be comprehensive and detailed while remaining clear and accessible.`;
}

/**
 * Format files for inclusion in the user prompt
 */
function formatFiles(files: TextFile[]): string {
  if (files.length === 0) {
    return 'No content files provided for this directory.';
  }

  return files.map((file, index) => {
    // Truncate very long content for readability
    const maxLength = 1500;
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
  const filesSection = `## Content Files\n\n${formatFiles(request.files)}`;

  return `Directory: ${request.directory_name}

${filesSection}

Generate a comprehensive wiki-style markdown article documenting this collection. Include all relevant information from the files above, organized in a clear and engaging way.`;
}
