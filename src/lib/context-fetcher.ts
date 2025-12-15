/**
 * Fetch description context from IPFS
 *
 * All data is fetched from IPFS via the entity's components.
 * After OCR phase, refs already have OCR text included.
 */

import { IPFSClient, Entity } from '../services/ipfs-client';
import { DescriptionContext } from '../types';

// Text file extensions to fetch as content
const TEXT_EXTENSIONS = [
  '.txt', '.md', '.json', '.xml', '.html', '.htm', '.csv', '.tsv',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.log',
  '.rst', '.tex', '.rtf', '.asc', '.nfo'
];

/**
 * Check if a filename is a text file we should fetch
 */
function isTextFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  // Skip special files that we handle separately
  if (lower === 'pinax.json' || lower === 'cheimarros.json' || lower === 'description.md') {
    return false;
  }
  // Skip ref files (handled separately)
  if (lower.endsWith('.ref.json')) {
    return false;
  }
  return TEXT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Fetch all context needed for description generation
 */
export async function fetchDescriptionContext(
  pi: string,
  ipfsClient: IPFSClient
): Promise<DescriptionContext> {
  const entity = await ipfsClient.getEntity(pi);
  const files: Array<{ filename: string; content: string }> = [];

  // 1. Fetch all text files from components
  const textFilePromises: Promise<void>[] = [];
  for (const [filename, cid] of Object.entries(entity.components)) {
    if (isTextFile(filename)) {
      textFilePromises.push(
        (async () => {
          try {
            const content = await ipfsClient.downloadContent(cid);
            files.push({ filename, content });
          } catch (e) {
            console.warn(`[ContextFetcher] Failed to fetch text file ${filename} for ${pi}: ${e}`);
          }
        })()
      );
    }
  }
  await Promise.all(textFilePromises);

  // 2. Fetch pinax.json if exists (separate from text files for clarity in logs)
  if (entity.components['pinax.json']) {
    try {
      const content = await ipfsClient.downloadContent(entity.components['pinax.json']);
      files.push({ filename: 'pinax.json', content });
    } catch (e) {
      console.warn(`[ContextFetcher] Failed to fetch pinax.json for ${pi}: ${e}`);
    }
  }

  // 3. Fetch cheimarros.json if exists
  if (entity.components['cheimarros.json']) {
    try {
      const content = await ipfsClient.downloadContent(entity.components['cheimarros.json']);
      files.push({ filename: 'cheimarros.json', content });
    } catch (e) {
      console.warn(`[ContextFetcher] Failed to fetch cheimarros.json for ${pi}: ${e}`);
    }
  }

  // 4. Fetch all refs from IPFS (includes OCR after OCR phase)
  const refPromises: Promise<void>[] = [];
  for (const [filename, cid] of Object.entries(entity.components)) {
    if (filename.endsWith('.ref.json')) {
      refPromises.push(
        (async () => {
          try {
            const content = await ipfsClient.downloadContent(cid);
            files.push({ filename, content });
          } catch (e) {
            console.warn(`[ContextFetcher] Failed to fetch ref ${filename} for ${pi}: ${e}`);
          }
        })()
      );
    }
  }
  await Promise.all(refPromises);

  // 4. Fetch child descriptions
  if (entity.children_pi && entity.children_pi.length > 0) {
    const childPromises = entity.children_pi.map(async (childPi, index) => {
      try {
        const childEntity = await ipfsClient.getEntity(childPi);
        if (childEntity.components['description.md']) {
          const content = await ipfsClient.downloadContent(
            childEntity.components['description.md']
          );
          files.push({
            filename: `child_description_${index}.md`,
            content,
          });
        }
      } catch (e) {
        console.warn(`[ContextFetcher] Failed to fetch child ${childPi} description: ${e}`);
      }
    });
    await Promise.all(childPromises);
  }

  // 5. Fetch existing description if present (for context in reprocessing)
  if (entity.components['description.md']) {
    try {
      const content = await ipfsClient.downloadContent(entity.components['description.md']);
      files.push({ filename: '[PREVIOUS] description.md', content });
    } catch (e) {
      console.warn(`[ContextFetcher] Failed to fetch existing description for ${pi}: ${e}`);
    }
  }

  // Directory name: use last segment of a path-like identifier or last 8 chars of PI
  const directoryName = extractDirectoryName(pi);

  console.log(
    `[ContextFetcher] Fetched context for ${pi}: ${files.length} files ` +
      `(pinax: ${entity.components['pinax.json'] ? 'yes' : 'no'}, ` +
      `cheimarros: ${entity.components['cheimarros.json'] ? 'yes' : 'no'}, ` +
      `refs: ${Object.keys(entity.components).filter((k) => k.endsWith('.ref.json')).length}, ` +
      `children: ${entity.children_pi?.length || 0})`
  );

  return { directory_name: directoryName, files };
}

/**
 * Extract a human-readable directory name from the PI
 */
function extractDirectoryName(pi: string): string {
  // PI is typically a ULID - use last 8 chars as identifier
  return pi.slice(-8);
}
