import { randomUUID } from "crypto";
import type { CodeChunk, ChunkType, DocType, RAGConfig } from "./types.js";
import type { ParsedEntity } from "./parser.js";
import type { ParsedDocument, DocSection } from "./doc-parser.js";
import { getConfigValue } from "../utils.js";

/** Default chunk configuration */
const DEFAULT_CHUNK_SIZE = 300;
const DEFAULT_OVERLAP = 50;

/**
 * Estimate token count from text
 * Uses approximation based on configurable characters per token ratio
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / getConfigValue("TOKENS_CHARS_RATIO"));
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

// ===== Document Chunking =====

/**
 * Map document type to chunk type
 */
function getDocChunkType(docType: DocType): ChunkType {
  const mapping: Record<DocType, ChunkType> = {
    prd: "doc_prd",
    adr: "doc_adr",
    api: "doc_api",
    notes: "doc_notes",
  };
  return mapping[docType];
}

/**
 * Create a documentation chunk from a section
 */
function createDocChunk(
  section: DocSection,
  doc: ParsedDocument,
  index?: number
): CodeChunk {
  const isPartOfLarger = index !== undefined;
  const content = `# ${section.heading}\n\n${section.content}`;

  const baseChunk = {
    id: randomUUID(),
    content,
    type: getDocChunkType(doc.docType),
    filePath: doc.filePath,
    startLine: section.startLine,
    endLine: section.endLine,
    name: isPartOfLarger ? `${section.heading}[${index}]` : section.heading,
    tokenCount: estimateTokens(content),
    docType: doc.docType,
  };

  if (isPartOfLarger) {
    return { ...baseChunk, parentId: section.heading };
  }

  return baseChunk;
}

/**
 * Split a large section into smaller chunks by paragraphs
 */
function splitLargeSection(
  section: DocSection,
  doc: ParsedDocument,
  chunkSize: number,
  overlap: number
): readonly CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const paragraphs = section.content.split(/\n\n+/);

  let currentChunk: string[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  // Add heading tokens to budget
  const headingTokens = estimateTokens(`# ${section.heading}\n\n`);

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) continue;

    const paragraphTokens = estimateTokens(paragraph);

    // Check if adding this paragraph would exceed chunk size
    if (
      currentTokens + paragraphTokens + headingTokens > chunkSize &&
      currentChunk.length > 0
    ) {
      // Save current chunk
      const chunkSection: DocSection = {
        heading: section.heading,
        level: section.level,
        content: currentChunk.join("\n\n"),
        startLine: section.startLine,
        endLine: section.endLine,
      };
      chunks.push(createDocChunk(chunkSection, doc, chunkIndex));

      // Calculate overlap paragraphs
      const avgTokensPerParagraph = currentTokens / currentChunk.length;
      const overlapParagraphs = Math.max(
        1,
        Math.ceil(overlap / avgTokensPerParagraph)
      );

      // Start new chunk with overlap
      currentChunk = currentChunk.slice(-overlapParagraphs);
      currentTokens = estimateTokens(currentChunk.join("\n\n"));
      chunkIndex++;
    }

    currentChunk.push(paragraph);
    currentTokens += paragraphTokens;
  }

  // Save last chunk
  if (currentChunk.length > 0) {
    const chunkSection: DocSection = {
      heading: section.heading,
      level: section.level,
      content: currentChunk.join("\n\n"),
      startLine: section.startLine,
      endLine: section.endLine,
    };
    chunks.push(createDocChunk(chunkSection, doc, chunkIndex));
  }

  // If only one chunk, remove index suffix
  if (chunks.length === 1 && chunks[0]) {
    return [createDocChunk(section, doc)];
  }

  return chunks;
}

/**
 * Create chunks from a parsed document's sections
 * @param doc - Parsed document with sections
 * @param config - Optional RAG configuration
 * @returns Array of code chunks for the document
 */
export function chunkDocumentSections(
  doc: ParsedDocument,
  config?: Partial<RAGConfig>
): readonly CodeChunk[] {
  const chunkSize = config?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = config?.chunkOverlap ?? DEFAULT_OVERLAP;

  const chunks: CodeChunk[] = [];

  for (const section of doc.sections) {
    // Skip empty sections
    if (!section.content.trim() && !section.heading.trim()) continue;

    const content = `# ${section.heading}\n\n${section.content}`;
    const tokenCount = estimateTokens(content);

    if (tokenCount <= chunkSize) {
      // Section fits in one chunk
      chunks.push(createDocChunk(section, doc));
    } else {
      // Split large section
      const splitChunks = splitLargeSection(section, doc, chunkSize, overlap);
      chunks.push(...splitChunks);
    }
  }

  return chunks;
}
