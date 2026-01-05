import { randomUUID } from "crypto";
import type { CodeChunk, RAGConfig } from "./types.js";
import type { ParsedEntity } from "./parser.js";

/** Default chunk configuration */
const DEFAULT_CHUNK_SIZE = 300;
const DEFAULT_OVERLAP = 50;
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count from text
 * Uses approximation of ~4 characters per token
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Create a CodeChunk from a ParsedEntity
 */
function createChunk(
  entity: ParsedEntity,
  content: string,
  index?: number
): CodeChunk {
  const isPartOfLarger = index !== undefined;

  const baseChunk = {
    id: randomUUID(),
    content,
    type: entity.type,
    filePath: entity.filePath,
    startLine: entity.startLine,
    endLine: entity.endLine,
    name: isPartOfLarger ? `${entity.name}[${index}]` : entity.name,
    tokenCount: estimateTokens(content),
  };

  // Only add parentId when chunk is part of a larger entity
  // This satisfies exactOptionalPropertyTypes constraint
  if (isPartOfLarger) {
    return { ...baseChunk, parentId: entity.name };
  }

  return baseChunk;
}

/**
 * Split a large entity into multiple chunks with overlap
 * Uses line-based splitting to preserve code structure
 */
function splitLargeEntity(
  entity: ParsedEntity,
  chunkSize: number,
  overlap: number
): readonly CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = entity.code.split("\n");

  // Handle edge case: single very long line
  if (lines.length === 1) {
    return [createChunk(entity, entity.code)];
  }

  let currentChunk: string[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Safety check for undefined (noUncheckedIndexedAccess)
    if (line === undefined) continue;

    const lineTokens = estimateTokens(line);

    // Check if adding this line would exceed chunk size
    if (currentTokens + lineTokens > chunkSize && currentChunk.length > 0) {
      // Save current chunk
      chunks.push(createChunk(entity, currentChunk.join("\n"), chunkIndex));

      // Calculate overlap lines based on average tokens per line
      const avgTokensPerLine = currentTokens / currentChunk.length;
      const overlapLines = Math.max(1, Math.ceil(overlap / avgTokensPerLine));

      // Start new chunk with overlap from previous
      currentChunk = currentChunk.slice(-overlapLines);
      currentTokens = estimateTokens(currentChunk.join("\n"));
      chunkIndex++;
    }

    currentChunk.push(line);
    currentTokens += lineTokens;
  }

  // Save the last chunk if it has content
  if (currentChunk.length > 0) {
    chunks.push(createChunk(entity, currentChunk.join("\n"), chunkIndex));
  }

  // If we only created one chunk, remove the index suffix
  if (chunks.length === 1 && chunks[0]) {
    return [createChunk(entity, entity.code)];
  }

  return chunks;
}

/**
 * Convert parsed entities to chunks
 * Entities larger than chunkSize are split with overlap
 * @param entities - Parsed entities from parser
 * @param config - Optional RAG configuration for chunk sizes
 * @returns Array of code chunks
 */
export function chunkEntities(
  entities: readonly ParsedEntity[],
  config?: Partial<RAGConfig>
): readonly CodeChunk[] {
  const chunkSize = config?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = config?.chunkOverlap ?? DEFAULT_OVERLAP;

  const chunks: CodeChunk[] = [];

  for (const entity of entities) {
    const tokenCount = estimateTokens(entity.code);

    if (tokenCount <= chunkSize) {
      // Entity fits in one chunk
      chunks.push(createChunk(entity, entity.code));
    } else {
      // Split large entity into multiple chunks
      const splitChunks = splitLargeEntity(entity, chunkSize, overlap);
      chunks.push(...splitChunks);
    }
  }

  return chunks;
}

/**
 * Process and chunk an entire codebase
 * @param files - List of absolute TypeScript file paths
 * @param config - Optional RAG configuration
 * @returns All chunks from the codebase
 */
export async function chunkCodebase(
  files: readonly string[],
  config?: Partial<RAGConfig>
): Promise<readonly CodeChunk[]> {
  // Dynamic import to avoid circular dependency issues
  const { parseTypeScriptFile } = await import("./parser.js");

  const allChunks: CodeChunk[] = [];

  for (const file of files) {
    try {
      const entities = await parseTypeScriptFile(file);
      const chunks = chunkEntities(entities, config);
      allChunks.push(...chunks);
    } catch (error) {
      // Log warning but continue processing other files
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.warn(`[RAG] Failed to parse ${file}: ${errorMessage}`);
    }
  }

  return allChunks;
}
