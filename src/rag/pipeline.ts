import { join } from "path";
import type {
  RAGConfig,
  RAGQueryResult,
  SearchResult,
  ChunkMetadata,
  CodeChunk,
} from "./types.js";
import type {
  LLMCompletionProvider,
  LLMEmbeddingProvider,
} from "../llm/types.js";
import { CodeVectorStore } from "./store.js";
import { findTypeScriptFiles } from "./parser.js";
import { chunkCodebase } from "./chunker.js";
import { rerankWithLLM, resolveParentChunks } from "./retriever.js";
import { RAGConfigSchema } from "./types.js";

/** Index version for compatibility checking */
const INDEX_VERSION = "1.0.0";

/** Default filename for persisted index */
const DEFAULT_STORE_FILENAME = "rag-index.json";

/** Batch size for embedding generation */
const EMBEDDING_BATCH_SIZE = 10;

/**
 * RAG Pipeline for codebase indexing and querying
 *
 * Orchestrates the full RAG workflow:
 * 1. Indexing: Parse -> Chunk -> Embed -> Store
 * 2. Querying: Embed query -> Vector search -> Rerank -> Generate answer
 */
export class RAGPipeline {
  private readonly config: RAGConfig;
  private readonly store: CodeVectorStore;
  private allChunks: CodeChunk[] = [];

  /**
   * Create new RAG pipeline
   * @param config - Optional RAG configuration overrides
   */
  constructor(config?: Partial<RAGConfig>) {
    this.config = RAGConfigSchema.parse(config ?? {});
    this.store = new CodeVectorStore();
  }

  /**
   * Index a codebase directory
   *
   * @param projectPath - Absolute path to project root
   * @param embeddingProvider - Provider for generating embeddings
   * @param storePath - Optional directory path to save the index
   * @returns Index metadata with statistics
   */
  async index(
    projectPath: string,
    embeddingProvider: LLMEmbeddingProvider,
    storePath?: string
  ): Promise<ChunkMetadata> {
    console.log(`[RAG] Indexing project: ${projectPath}`);

    // Clear previous data before indexing
    this.allChunks = [];
    this.store.clear();

    // Find all TypeScript files
    const files = await findTypeScriptFiles(projectPath);
    console.log(`[RAG] Found ${files.length} TypeScript files`);

    if (files.length === 0) {
      throw new Error(`No TypeScript files found in ${projectPath}`);
    }

    // Parse and chunk
    const chunks = await chunkCodebase(files, this.config);
    console.log(`[RAG] Created ${chunks.length} chunks`);

    if (chunks.length === 0) {
      throw new Error("No chunks generated from files");
    }

    // Store chunks for parent retrieval
    this.allChunks = [...chunks];

    // Generate embeddings in batches
    const embeddings: number[][] = [];
    const totalBatches = Math.ceil(chunks.length / EMBEDDING_BATCH_SIZE);

    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
      const contents = batch.map((c) => c.content);
      const batchNumber = Math.floor(i / EMBEDDING_BATCH_SIZE) + 1;

      console.log(`[RAG] Embedding batch ${batchNumber}/${totalBatches}`);

      const batchEmbeddings = await embeddingProvider.embedBatch(contents);
      embeddings.push(...batchEmbeddings.map((e) => [...e.values]));
    }

    // Populate store (already cleared at method start)
    this.store.addChunks(chunks, embeddings);

    // Create metadata
    const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
    const metadata: ChunkMetadata = {
      projectPath,
      totalChunks: chunks.length,
      totalTokens,
      indexedAt: new Date().toISOString(),
      version: INDEX_VERSION,
    };
    this.store.setMetadata(metadata);

    // Save if path provided
    if (storePath !== undefined) {
      const fullPath = join(storePath, DEFAULT_STORE_FILENAME);
      await this.store.save(fullPath);
      console.log(`[RAG] Index saved to ${fullPath}`);
    }

    console.log(
      `[RAG] Indexing complete: ${chunks.length} chunks, ${totalTokens} tokens`
    );

    return metadata;
  }

  /**
   * Load existing index from disk
   *
   * @param storePath - Directory containing the index file
   * @returns Metadata if loaded successfully, null if file doesn't exist or version mismatch
   */
  async loadIndex(storePath: string): Promise<ChunkMetadata | null> {
    const fullPath = join(storePath, DEFAULT_STORE_FILENAME);

    if (!(await CodeVectorStore.exists(fullPath))) {
      console.log(`[RAG] No index found at ${fullPath}`);
      return null;
    }

    console.log(`[RAG] Loading index from ${fullPath}`);
    await this.store.load(fullPath);

    const metadata = this.store.getMetadata();

    // Validate version - force re-index if mismatch
    if (metadata && metadata.version !== INDEX_VERSION) {
      console.warn(
        `[RAG] Index version mismatch: expected ${INDEX_VERSION}, got ${metadata.version}`
      );
      this.store.clear();
      this.allChunks = [];
      return null; // Force re-index
    }

    // Populate allChunks from loaded store
    this.allChunks = [...this.store.getAllChunks()];

    if (metadata) {
      console.log(
        `[RAG] Loaded index: ${metadata.totalChunks} chunks from ${metadata.projectPath}`
      );
    }

    return metadata;
  }

  /**
   * Query the indexed codebase
   *
   * @param query - User question about the codebase
   * @param embeddingProvider - Provider for query embedding
   * @param completionProvider - Provider for reranking and answer generation
   * @returns Query result with answer and source chunks
   * @throws Error if index is empty
   */
  async query(
    query: string,
    embeddingProvider: LLMEmbeddingProvider,
    completionProvider: LLMCompletionProvider
  ): Promise<RAGQueryResult> {
    if (this.store.isEmpty()) {
      throw new Error("Index is empty. Run index() or loadIndex() first.");
    }

    console.log(`[RAG] Processing query: "${query.substring(0, 50)}..."`);

    // Get query embedding
    const queryEmbedding = await embeddingProvider.embed(query);

    // Vector search
    const vectorResults = this.store.search(
      queryEmbedding.values,
      this.config.topK
    );
    console.log(`[RAG] Vector search returned ${vectorResults.length} results`);

    if (vectorResults.length === 0) {
      return {
        answer: "No relevant code found for your query.",
        sources: [],
        tokenCount: 0,
      };
    }

    // LLM reranking
    const rerankedResults = await rerankWithLLM(
      vectorResults,
      query,
      completionProvider,
      this.config
    );
    console.log(`[RAG] Reranked to ${rerankedResults.length} results`);

    // Resolve parent chunks for additional context
    const resolvedResults = resolveParentChunks(
      rerankedResults,
      this.allChunks
    );

    // Generate answer
    const answer = await this.generateAnswer(
      query,
      resolvedResults,
      completionProvider
    );

    return {
      answer: answer.text,
      sources: resolvedResults,
      tokenCount: answer.tokenCount,
    };
  }

  /**
   * Generate answer from retrieved chunks using LLM
   */
  private async generateAnswer(
    query: string,
    sources: readonly SearchResult[],
    llm: LLMCompletionProvider
  ): Promise<{ text: string; tokenCount: number }> {
    // Build context from sources
    const context = sources
      .map((s, i) => {
        const location = `${s.chunk.filePath}:${s.chunk.startLine}`;
        const header = `[${i + 1}] ${s.chunk.type} "${s.chunk.name}" (${location})`;
        return `${header}:\n\`\`\`\n${s.chunk.content}\n\`\`\``;
      })
      .join("\n\n");

    const prompt = `You are a code analysis assistant. Answer the user's question based on the code snippets provided.

USER QUESTION: ${query}

RELEVANT CODE SNIPPETS:
${context}

Instructions:
- Provide a clear, concise answer based on the code snippets
- Reference snippets by number [1], [2], etc. when relevant
- If the snippets don't contain enough information to fully answer, say so
- Focus on accuracy over speculation`;

    const result = await llm.complete(prompt, {
      temperature: 0.3,
      maxTokens: 2048,
    });

    return {
      text: result.text,
      tokenCount: result.tokenCount,
    };
  }

  /**
   * Get current pipeline status
   * @returns Object with indexed flag and metadata
   */
  getStatus(): { indexed: boolean; metadata: ChunkMetadata | null } {
    return {
      indexed: !this.store.isEmpty(),
      metadata: this.store.getMetadata(),
    };
  }

  /**
   * Get chunk count in current index
   */
  getChunkCount(): number {
    return this.store.size();
  }

  /**
   * Clear the current index
   */
  clear(): void {
    this.store.clear();
    this.allChunks = [];
  }
}
