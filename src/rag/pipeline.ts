import { join } from "path";
import { createHash } from "crypto";
import { readFile, stat } from "fs/promises";
import type {
  RAGConfig,
  RAGQueryResult,
  SearchResult,
  ChunkMetadata,
  CodeChunk,
  FileManifest,
  FileEntry,
  IncrementalIndexResult,
  FileChanges,
} from "./types.js";
import { MANIFEST_VERSION } from "./types.js";
import type {
  LLMCompletionProvider,
  LLMEmbeddingProvider,
} from "../llm/types.js";
import { CodeVectorStore } from "./store.js";
import { findTypeScriptFiles, parseTypeScriptFile } from "./parser.js";
import { chunkCodebase, chunkDocumentSections, chunkEntities } from "./chunker.js";
import { findDocumentFiles, parseMarkdownFile } from "./doc-parser.js";
import { rerankWithLLM, resolveParentChunks } from "./retriever.js";
import { RAGConfigSchema } from "./types.js";
import { getConfigValue } from "../utils.js";

/** Index version for compatibility checking */
const INDEX_VERSION = "1.1.0"; // Updated for ai-docs support

/** Default filename for persisted index */
const DEFAULT_STORE_FILENAME = "rag-index.json";

/**
 * Compute SHA256 hash of file content
 */
async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Get file modification time in ms (floored to integer for reliable comparison)
 */
async function getFileMtime(filePath: string): Promise<number> {
  const stats = await stat(filePath);
  return Math.floor(stats.mtimeMs);
}

/**
 * Detect which files changed since last indexing
 */
async function detectFileChanges(
  currentFiles: readonly string[],
  manifest: FileManifest | null
): Promise<FileChanges> {
  const added: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];

  const currentFileSet = new Set(currentFiles);
  const manifestFiles = manifest?.files ?? {};

  for (const filePath of currentFiles) {
    const entry = manifestFiles[filePath];

    if (!entry) {
      added.push(filePath);
      continue;
    }

    try {
      // Quick check: mtime changed?
      const currentMtime = await getFileMtime(filePath);
      if (currentMtime === entry.mtime) {
        unchanged.push(filePath);
        continue;
      }

      // mtime changed → verify with content hash
      const currentHash = await computeFileHash(filePath);
      if (currentHash !== entry.contentHash) {
        modified.push(filePath);
      } else {
        unchanged.push(filePath);
      }
    } catch {
      // File deleted between findFiles and detectChanges - will be caught as deleted
      console.warn(`[RAG] File disappeared during change detection: ${filePath}`);
    }
  }

  // Find deleted files
  const deleted: string[] = [];
  for (const filePath of Object.keys(manifestFiles)) {
    if (!currentFileSet.has(filePath)) {
      deleted.push(filePath);
    }
  }

  return { added, modified, deleted, unchanged };
}

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

    // Parse and chunk TypeScript files
    const codeChunks = await chunkCodebase(files, this.config);
    console.log(`[RAG] Created ${codeChunks.length} code chunks`);

    // Also index documentation from ai-docs/ if present
    const docsPath = join(projectPath, "ai-docs");
    let docChunks: CodeChunk[] = [];

    try {
      const docFiles = await findDocumentFiles(docsPath);
      if (docFiles.length > 0) {
        console.log(`[RAG] Found ${docFiles.length} documentation files in ai-docs/`);

        for (const docFile of docFiles) {
          try {
            const doc = await parseMarkdownFile(docFile);
            const chunks = chunkDocumentSections(doc, this.config);
            docChunks.push(...chunks);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.warn(`[RAG] Failed to parse doc ${docFile}: ${errorMsg}`);
          }
        }

        console.log(`[RAG] Created ${docChunks.length} documentation chunks`);
      }
    } catch {
      // ai-docs folder doesn't exist - that's fine, skip silently
      console.log(`[RAG] No ai-docs folder found, skipping documentation indexing`);
    }

    // Combine code and documentation chunks
    const allChunks = [...codeChunks, ...docChunks];

    if (allChunks.length === 0) {
      throw new Error("No chunks generated from files");
    }

    // Store chunks for parent retrieval
    this.allChunks = allChunks;
    const chunks = allChunks;

    // Generate embeddings in batches
    const embeddings: number[][] = [];
    const batchSize = getConfigValue("RAG_EMBEDDING_BATCH_SIZE");
    const totalBatches = Math.ceil(chunks.length / batchSize);

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const contents = batch.map((c) => c.content);
      const batchNumber = Math.floor(i / batchSize) + 1;

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

    // Build manifest for future incremental indexing
    const manifestEntries: Record<string, FileEntry> = {};

    // Group chunks by filePath
    const chunksByFile = new Map<string, CodeChunk[]>();
    for (const chunk of chunks) {
      if (!chunksByFile.has(chunk.filePath)) {
        chunksByFile.set(chunk.filePath, []);
      }
      chunksByFile.get(chunk.filePath)!.push(chunk);
    }

    // Build manifest entries
    for (const [filePath, fileChunks] of chunksByFile) {
      try {
        const contentHash = await computeFileHash(filePath);
        const mtime = await getFileMtime(filePath);
        manifestEntries[filePath] = {
          contentHash,
          chunkIds: fileChunks.map((c) => c.id),
          mtime,
        };
      } catch (error) {
        console.warn(
          `[RAG] Could not create manifest entry for ${filePath}: ${error}`
        );
      }
    }

    const manifest: FileManifest = {
      files: manifestEntries,
      version: MANIFEST_VERSION,
    };
    this.store.setManifest(manifest);

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
   * Incrementally index only changed files
   *
   * @param projectPath - Absolute path to project root
   * @param embeddingProvider - Provider for generating embeddings
   * @param storePath - Optional directory path to save the index
   * @returns Incremental index result with stats
   */
  async indexIncremental(
    projectPath: string,
    embeddingProvider: LLMEmbeddingProvider,
    storePath?: string
  ): Promise<IncrementalIndexResult> {
    console.log(`[RAG] Incremental indexing: ${projectPath}`);

    // 1. Find all current files
    const tsFiles = await findTypeScriptFiles(projectPath);
    const docsPath = join(projectPath, "ai-docs");
    let docFiles: string[] = [];
    try {
      docFiles = [...(await findDocumentFiles(docsPath))];
    } catch {
      // ai-docs doesn't exist - that's fine
    }
    const currentFiles = [...tsFiles, ...docFiles];

    // 2. Get existing manifest
    const manifest = this.store.getManifest();

    // Check manifest version compatibility
    if (manifest && manifest.version !== MANIFEST_VERSION) {
      console.log(
        `[RAG] Manifest version mismatch (${manifest.version} vs ${MANIFEST_VERSION}), forcing full reindex`
      );
      const metadata = await this.index(projectPath, embeddingProvider, storePath);
      return {
        metadata,
        stats: { added: 0, modified: 0, deleted: 0, unchanged: 0 },
      };
    }

    // 3. Detect changes
    const changes = await detectFileChanges(currentFiles, manifest);

    console.log(
      `[RAG] Changes: +${changes.added.length} ~${changes.modified.length} -${changes.deleted.length} =${changes.unchanged.length}`
    );

    // 4. Early exit if no changes
    if (
      changes.added.length === 0 &&
      changes.modified.length === 0 &&
      changes.deleted.length === 0
    ) {
      console.log(`[RAG] No changes detected`);
      const existingMetadata = this.store.getMetadata();
      if (!existingMetadata) {
        throw new Error("No existing metadata found");
      }
      return {
        metadata: existingMetadata,
        stats: {
          added: 0,
          modified: 0,
          deleted: 0,
          unchanged: changes.unchanged.length,
        },
      };
    }

    // 5. Remove chunks for deleted and modified files
    const filesToRemove = [...changes.deleted, ...changes.modified];
    for (const filePath of filesToRemove) {
      this.store.removeChunksByFile(filePath);
    }

    // 6. Remove from allChunks
    const removedFilePaths = new Set(filesToRemove);
    this.allChunks = this.allChunks.filter(
      (c) => !removedFilePaths.has(c.filePath)
    );

    // 7. Process new and modified files
    const filesToProcess = [...changes.added, ...changes.modified];
    const newChunks: CodeChunk[] = [];
    const newManifestEntries: Record<string, FileEntry> = {};

    for (const filePath of filesToProcess) {
      try {
        let chunks: CodeChunk[];

        if (filePath.endsWith(".md")) {
          const doc = await parseMarkdownFile(filePath);
          chunks = [...chunkDocumentSections(doc, this.config)];
        } else {
          const entities = await parseTypeScriptFile(filePath);
          chunks = [...chunkEntities(entities, this.config)];
        }

        newChunks.push(...chunks);

        const contentHash = await computeFileHash(filePath);
        const mtime = await getFileMtime(filePath);
        newManifestEntries[filePath] = {
          contentHash,
          chunkIds: chunks.map((c) => c.id),
          mtime,
        };
      } catch (error) {
        console.warn(`[RAG] Failed to process ${filePath}: ${error}`);
      }
    }

    // 8. Generate embeddings for new chunks
    if (newChunks.length > 0) {
      const embeddings: number[][] = [];
      const batchSize = getConfigValue("RAG_EMBEDDING_BATCH_SIZE");
      const totalBatches = Math.ceil(newChunks.length / batchSize);

      for (let i = 0; i < newChunks.length; i += batchSize) {
        const batchNum = Math.floor(i / batchSize) + 1;
        console.log(`[RAG] Embedding batch ${batchNum}/${totalBatches}`);

        const batch = newChunks.slice(i, i + batchSize);
        const contents = batch.map((c) => c.content);
        const batchEmbeddings = await embeddingProvider.embedBatch(contents);
        embeddings.push(...batchEmbeddings.map((e) => [...e.values]));
      }

      this.store.addChunks(newChunks, embeddings);
      this.allChunks.push(...newChunks);
    }

    // 9. Update manifest
    const existingManifest = manifest?.files ?? {};
    const updatedManifestFiles: Record<string, FileEntry> = {};

    // Keep unchanged files
    for (const filePath of changes.unchanged) {
      const entry = existingManifest[filePath];
      if (entry) {
        updatedManifestFiles[filePath] = entry;
      }
    }

    // Add new/modified files
    for (const [filePath, entry] of Object.entries(newManifestEntries)) {
      updatedManifestFiles[filePath] = entry;
    }

    const newManifest: FileManifest = {
      files: updatedManifestFiles,
      version: MANIFEST_VERSION,
    };
    this.store.setManifest(newManifest);

    // 10. Update metadata
    const totalTokens = this.allChunks.reduce((sum, c) => sum + c.tokenCount, 0);
    const metadata: ChunkMetadata = {
      projectPath,
      totalChunks: this.allChunks.length,
      totalTokens,
      indexedAt: new Date().toISOString(),
      version: INDEX_VERSION,
    };
    this.store.setMetadata(metadata);

    // 11. Save
    if (storePath !== undefined) {
      const fullPath = join(storePath, DEFAULT_STORE_FILENAME);
      await this.store.save(fullPath);
    }

    return {
      metadata,
      stats: {
        added: changes.added.length,
        modified: changes.modified.length,
        deleted: changes.deleted.length,
        unchanged: changes.unchanged.length,
      },
    };
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
   * Check if manifest exists for incremental indexing
   * @returns true if manifest is available
   */
  hasManifest(): boolean {
    return this.store.getManifest() !== null;
  }

  /**
   * Clear the current index
   */
  clear(): void {
    this.store.clear();
    this.allChunks = [];
  }
}
