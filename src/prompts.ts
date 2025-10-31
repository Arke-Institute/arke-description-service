/**
 * Prompt generation for the archivist LLM
 */

import type { SummarizeRequest, TextFile } from './types';

/**
 * Generate system prompt for the archivist role
 */
export function generateSystemPrompt(): string {
  return `You are an archivist cataloging a historical photo collection. You are examining a directory with various text files containing information.

Your task is to:
1. Analyze all provided text files (which may be in various formats: JSON, XML, TXT, Markdown, CSV, etc.)
2. Synthesize information from all sources into a coherent understanding
3. Respect any manual metadata provided by curators
4. Generate a descriptive markdown document summarizing the contents
5. Extract or infer structured metadata (dates, locations, people, events, themes, etc.)

Format your response as a markdown document with:
- A clear title (# Header)
- Descriptive sections that capture the essence of the collection
- Context and historical significance where appropriate
- Cohesive narrative that connects all information

After the markdown description, provide structured metadata as a JSON object.`;
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
 * Format manual metadata for inclusion in the user prompt
 */
function formatManualMetadata(metadata: any): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return '';
  }

  return `\n\n## Manual Metadata\n\nCurator-provided metadata for this directory:\n\n${JSON.stringify(metadata, null, 2)}`;
}

/**
 * Generate the complete user prompt
 */
export function generateUserPrompt(request: SummarizeRequest): string {
  const filesSection = `## Content Files\n\n${formatFiles(request.files)}`;
  const metadataSection = formatManualMetadata(request.manual_metadata);

  return `Directory: ${request.directory_name}

${filesSection}${metadataSection}

Please provide:
1. A markdown description of this directory's contents
2. Structured metadata as a JSON object

Format your response with the markdown description first, followed by a JSON code block containing the metadata.`;
}
