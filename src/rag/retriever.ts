import type { CodeChunk, SearchResult, RAGConfig } from "./types.js";
import type { LLMCompletionProvider } from "../llm/types.js";
import { withTimeout } from "../llm/timeout.js";

/** Batch size for parallel LLM scoring to avoid rate limits */
const SCORING_BATCH_SIZE = 5;

/** Default score when LLM scoring fails */
const DEFAULT_LLM_SCORE = 0.5;

/** Maximum content length for scoring prompt */
const MAX_CONTENT_FOR_SCORING = 1000;

/** Maximum query length to prevent abuse */
const MAX_QUERY_LENGTH = 2000;

/** Timeout for individual chunk scoring (15 seconds) */
const CHUNK_SCORING_TIMEOUT_MS = 15000;

/** Dynamic ranking weights based on query type */
interface QueryWeights {
  vectorWeight: number;
  llmWeight: number;
}

/**
 * Determine ranking weights based on query intent
 *
 * Search queries benefit from higher vector similarity weight (semantic match),
 * while explanation queries benefit from higher LLM weight (understanding context).
 *
 * NOTE: These dynamic weights override the vectorWeight/llmWeight from RAGConfig.
 * This is intentional - query-specific weights improve result quality.
 *
 * @param query - User query to analyze
 * @returns Weights for vector and LLM scores
 */
function getQueryWeights(query: string): QueryWeights {
  // Search-oriented patterns: user wants to find/locate specific code
  // \b doesn't work with Cyrillic, so use word boundaries only for English
  const searchPatterns =
    /\b(find|where|locate|show me|get|search|look for)\b|найди|где|покажи/i;
  if (searchPatterns.test(query)) {
    return { vectorWeight: 0.6, llmWeight: 0.4 };
  }

  // Explanation-oriented patterns: user wants to understand code
  // \b doesn't work with Cyrillic, so use word boundaries only for English
  const explainPatterns =
    /\b(explain|how|why|what does|describe)\b|объясни|как|почему|что делает/i;
  if (explainPatterns.test(query)) {
    return { vectorWeight: 0.2, llmWeight: 0.8 };
  }

  // Default balanced weights
  return { vectorWeight: 0.3, llmWeight: 0.7 };
}

/**
 * Normalize unicode to ASCII where possible to prevent homoglyph attacks
 * @param text - Text with potential unicode homoglyphs
 * @returns Normalized text
 */
function normalizeUnicode(text: string): string {
  // Normalize to NFKC form (compatibility decomposition + canonical composition)
  // This converts look-alike characters to their standard forms
  return text.normalize("NFKC");
}

/**
 * Remove control characters that could manipulate output
 * @param text - Text with potential control characters
 * @returns Cleaned text
 */
function removeControlCharacters(text: string): string {
  // Remove ASCII control chars (except tab, newline, carriage return)
  // Remove unicode control chars (categories Cc, Cf, Co, Cs except common whitespace)
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, ""); // Zero-width and special spaces
}

/**
 * Sanitize user query to prevent prompt injection
 * Uses defense in depth: normalize, clean, filter patterns, escape
 * @param query - Raw user query
 * @returns Sanitized query safe for LLM prompt
 */
function sanitizeQuery(query: string): string {
  // Step 1: Normalize unicode to prevent homoglyph attacks
  let sanitized = normalizeUnicode(query);

  // Step 2: Remove control characters
  sanitized = removeControlCharacters(sanitized);

  // Step 3: Remove structural markers that could break prompt boundaries
  sanitized = sanitized
    // Common injection patterns
    .replace(
      /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|context)/gi,
      "[filtered]"
    )
    .replace(
      /disregard\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?)/gi,
      "[filtered]"
    )
    .replace(
      /forget\s+(your\s+)?(role|instructions|purpose|training)/gi,
      "[filtered]"
    )
    .replace(/you\s+are\s+now\s+/gi, "[filtered] ")
    .replace(/new\s+instructions?\s*:/gi, "[filtered]")
    // Structural markers (XML-style, conversation markers)
    .replace(/<\/?system>/gi, "[filtered]")
    .replace(/<\/?human>/gi, "[filtered]")
    .replace(/<\/?assistant>/gi, "[filtered]")
    .replace(/<\/?user>/gi, "[filtered]")
    .replace(/\bHuman:\s*/gi, "[filtered] ")
    .replace(/\bAssistant:\s*/gi, "[filtered] ")
    .replace(/\bSystem:\s*/gi, "[filtered] ")
    .replace(/\bUser:\s*/gi, "[filtered] ")
    .replace(/\bAI:\s*/gi, "[filtered] ");

  // Step 4: Limit length
  sanitized = sanitized.substring(0, MAX_QUERY_LENGTH);

  // Step 5: Escape code block delimiters
  sanitized = sanitized.replace(/```/g, "\\`\\`\\`");

  return sanitized.trim();
}

/**
 * Validate LLM score response format
 * @param text - Raw LLM response text
 * @returns Parsed score or null if invalid format
 */
function parseScoreResponse(text: string): number | null {
  const scoreText = text.trim();

  // Only accept single number (integer or decimal)
  if (!/^\d+(\.\d+)?$/.test(scoreText)) {
    return null;
  }

  const score = parseFloat(scoreText);

  if (isNaN(score) || score < 0 || score > 10) {
    return null;
  }

  return score;
}

/**
 * Score chunk relevance to query using LLM
 * @param chunk - Code chunk to score
 * @param query - Original user query
 * @param llm - LLM provider for scoring
 * @returns Relevance score normalized to 0-1
 */
async function scoreChunkRelevance(
  chunk: CodeChunk,
  query: string,
  llm: LLMCompletionProvider
): Promise<number> {
  const truncatedContent = chunk.content.substring(0, MAX_CONTENT_FOR_SCORING);
  const sanitizedQuery = sanitizeQuery(query);

  const prompt = `You are a code relevance scorer. Rate how relevant the following code snippet is to the user's question.

USER QUESTION: ${sanitizedQuery}

CODE SNIPPET (${chunk.type} "${chunk.name}" from ${chunk.filePath}):
\`\`\`
${truncatedContent}
\`\`\`

Rate the relevance on a scale of 0 to 10, where:
- 0: Completely irrelevant
- 5: Somewhat related
- 10: Directly answers the question

Respond with ONLY a number from 0 to 10, nothing else.`;

  try {
    const result = await withTimeout(
      llm.complete(prompt, {
        temperature: 0,
        maxTokens: 10,
      }),
      { timeoutMs: CHUNK_SCORING_TIMEOUT_MS, context: "Chunk scoring" }
    );

    const score = parseScoreResponse(result.text);

    if (score === null) {
      console.warn(
        `[Retriever] Invalid score format: "${result.text.trim().substring(0, 50)}"`
      );
      return DEFAULT_LLM_SCORE;
    }

    return score / 10; // Normalize to 0-1
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[Retriever] LLM scoring failed: ${errorMessage}`);
    return DEFAULT_LLM_SCORE;
  }
}

/**
 * Rerank search results using LLM scoring
 *
 * Based on RAG Challenge approach combining vector similarity with LLM relevance:
 * finalScore = vectorWeight * vectorScore + llmWeight * llmScore
 *
 * @param results - Vector search results
 * @param query - Original user query
 * @param llm - LLM provider for scoring
 * @param config - RAG configuration with weights
 * @returns Reranked results with combined scores, limited to rerankTopK
 */
export async function rerankWithLLM(
  results: readonly SearchResult[],
  query: string,
  llm: LLMCompletionProvider,
  config: RAGConfig
): Promise<readonly SearchResult[]> {
  const { rerankTopK } = config;

  if (results.length === 0) {
    return [];
  }

  // Use dynamic weights based on query intent instead of fixed config weights
  const { vectorWeight, llmWeight } = getQueryWeights(query);

  const scoredResults: SearchResult[] = [];

  // Process in batches to avoid rate limits
  const totalBatches = Math.ceil(results.length / SCORING_BATCH_SIZE);
  for (let i = 0; i < results.length; i += SCORING_BATCH_SIZE) {
    const batchNum = Math.floor(i / SCORING_BATCH_SIZE) + 1;
    console.log(`[RAG] Scoring batch ${batchNum}/${totalBatches}...`);
    const batch = results.slice(i, i + SCORING_BATCH_SIZE);

    const batchPromises = batch.map(async (result) => {
      const llmScore = await scoreChunkRelevance(result.chunk, query, llm);
      const finalScore =
        vectorWeight * result.vectorScore + llmWeight * llmScore;

      return {
        chunk: result.chunk,
        vectorScore: result.vectorScore,
        llmScore,
        finalScore,
      } satisfies SearchResult;
    });

    // Use allSettled to handle individual failures gracefully
    const batchResults = await Promise.allSettled(batchPromises);

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        scoredResults.push(result.value);
      } else {
        console.warn("[Retriever] Batch scoring failed:", result.reason);
      }
    }
  }

  // Sort by final score descending and return top results
  scoredResults.sort((a, b) => b.finalScore - a.finalScore);

  return scoredResults.slice(0, rerankTopK);
}

/**
 * Resolve parent chunks for retrieved results (Parent Page Retrieval)
 *
 * If a chunk has parentId, fetches the parent entity to provide
 * additional context in the response.
 *
 * @param results - Search results with potential parent references
 * @param allChunks - All chunks from the store for parent lookup
 * @returns Results with parent context added to chunk content
 */
export function resolveParentChunks(
  results: readonly SearchResult[],
  allChunks: readonly CodeChunk[]
): readonly SearchResult[] {
  // Build lookup map by chunk ID (not name!) for parent resolution
  // Names can be duplicated, IDs are unique
  const chunkById = new Map<string, CodeChunk>();
  for (const chunk of allChunks) {
    chunkById.set(chunk.id, chunk);
  }

  return results.map((result) => {
    const { chunk } = result;

    // If chunk has parentId, try to get parent context
    if (chunk.parentId !== undefined) {
      const parent = chunkById.get(chunk.parentId);

      if (parent) {
        // Create new chunk with parent context prepended
        const enrichedChunk: CodeChunk = {
          ...chunk,
          content: `// Parent: ${parent.name} (${parent.type})\n// From: ${parent.filePath}:${parent.startLine}\n${chunk.content}`,
        };

        return {
          ...result,
          chunk: enrichedChunk,
        };
      }
    }

    return result;
  });
}
