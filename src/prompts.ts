/**
 * Prompt generation for the archivist LLM
 */

import type { SummarizeRequest, ChildOCR, ChildDescription } from './types';

/**
 * Generate system prompt for the archivist role
 * Different prompts for leaf nodes (only OCR) vs aggregation nodes (has child descriptions)
 */
export function generateSystemPrompt(hasChildDescriptions: boolean): string {
  if (hasChildDescriptions) {
    // Aggregation node: synthesizing information from subdirectories
    return `You are an archivist cataloging a historical photo collection. You are examining a directory that contains both images and subdirectories.

Your task is to:
1. Synthesize information from the OCR text of images in this directory
2. Incorporate descriptions from subdirectories that have already been cataloged
3. Respect any manual metadata provided by curators
4. Generate a coherent markdown description that rolls up all this information
5. Extract or infer structured metadata (dates, locations, people, events, themes, etc.)

Format your response as a markdown document with:
- A clear title (# Header)
- Descriptive sections that summarize the directory's contents
- Context that connects images and subdirectories into a cohesive narrative

After the markdown description, provide structured metadata as a JSON object.`;
  } else {
    // Leaf node: only processing OCR from images
    return `You are an archivist cataloging a historical photo collection. You are examining a directory containing images.

Your task is to:
1. Analyze the OCR text extracted from each image
2. Respect any manual metadata provided by curators
3. Generate a descriptive markdown document summarizing the contents
4. Extract or infer structured metadata (dates, locations, people, events, themes, etc.)

Format your response as a markdown document with:
- A clear title (# Header)
- Descriptive sections that capture the essence of the images
- Context and historical significance where appropriate

After the markdown description, provide structured metadata as a JSON object.`;
  }
}

/**
 * Format OCR data for inclusion in the user prompt
 */
function formatOCR(ocrData: ChildOCR[]): string {
  if (ocrData.length === 0) {
    return 'No images with OCR text in this directory.';
  }

  return ocrData.map((item, index) =>
    `Image ${index + 1}: ${item.name}\n${item.text}\n`
  ).join('\n---\n\n');
}

/**
 * Format child descriptions for inclusion in the user prompt
 */
function formatChildDescriptions(children: ChildDescription[]): string {
  if (children.length === 0) {
    return '';
  }

  const formatted = children.map((child, index) => {
    const metadataStr = child.metadata
      ? `\nMetadata: ${JSON.stringify(child.metadata, null, 2)}`
      : '';

    return `Subdirectory ${index + 1}: ${child.name}\n\n${child.description}${metadataStr}`;
  }).join('\n\n---\n\n');

  return `\n\n## Child Subdirectories\n\nThe following subdirectories have already been cataloged:\n\n${formatted}`;
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
  const ocrSection = `## OCR Text from Images\n\n${formatOCR(request.children_ocr)}`;
  const childrenSection = formatChildDescriptions(request.children_descriptions);
  const metadataSection = formatManualMetadata(request.manual_metadata);

  return `Directory: ${request.directory_name}

${ocrSection}${childrenSection}${metadataSection}

Please provide:
1. A markdown description of this directory's contents
2. Structured metadata as a JSON object

Format your response with the markdown description first, followed by a JSON code block containing the metadata.`;
}
