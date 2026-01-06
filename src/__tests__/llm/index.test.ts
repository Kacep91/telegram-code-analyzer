import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  LLMProviderType,
  ProviderFactoryConfig,
} from "../../llm/types.js";

// =============================================================================
// Mock setup - must be before imports that use mocked modules
// =============================================================================

// Use vi.hoisted to create mock functions that are accessible in vi.mock factories
const {
  mockOpenAICheckAvailability,
  mockGeminiCheckAvailability,
  mockAnthropicCheckAvailability,
  mockPerplexityCheckAvailability,
  openAIConstructorError,
  MockOpenAIProvider,
  MockGeminiProvider,
  MockAnthropicProvider,
  MockPerplexityProvider,
} = vi.hoisted(() => {
  const mockOpenAICheckAvailability = vi.fn();
  const mockGeminiCheckAvailability = vi.fn();
  const mockAnthropicCheckAvailability = vi.fn();
  const mockPerplexityCheckAvailability = vi.fn();

  // Shared state for controlling constructor behavior
  const openAIConstructorError: { value: Error | string | null } = {
    value: null,
  };

  // Create mock classes that can be instantiated with `new`
  const MockOpenAIProvider = vi.fn().mockImplementation(function (
    this: {
      name: "openai";
      complete: ReturnType<typeof vi.fn>;
      embed: ReturnType<typeof vi.fn>;
      embedBatch: ReturnType<typeof vi.fn>;
      checkAvailability: ReturnType<typeof vi.fn>;
    },
    _apiKey: string
  ) {
    if (openAIConstructorError.value !== null) {
      const error = openAIConstructorError.value;
      openAIConstructorError.value = null; // Reset after throwing
      throw error;
    }
    this.name = "openai";
    this.complete = vi.fn();
    this.embed = vi.fn();
    this.embedBatch = vi.fn();
    this.checkAvailability = mockOpenAICheckAvailability;
  });

  const MockGeminiProvider = vi.fn().mockImplementation(function (
    this: {
      name: "gemini";
      complete: ReturnType<typeof vi.fn>;
      embed: ReturnType<typeof vi.fn>;
      embedBatch: ReturnType<typeof vi.fn>;
      checkAvailability: ReturnType<typeof vi.fn>;
    },
    _config: { apiKey: string }
  ) {
    this.name = "gemini";
    this.complete = vi.fn();
    this.embed = vi.fn();
    this.embedBatch = vi.fn();
    this.checkAvailability = mockGeminiCheckAvailability;
  });

  const MockAnthropicProvider = vi.fn().mockImplementation(function (
    this: {
      name: "anthropic";
      complete: ReturnType<typeof vi.fn>;
      checkAvailability: ReturnType<typeof vi.fn>;
    },
    _apiKey: string
  ) {
    this.name = "anthropic";
    this.complete = vi.fn();
    this.checkAvailability = mockAnthropicCheckAvailability;
  });

  const MockPerplexityProvider = vi.fn().mockImplementation(function (
    this: {
      name: "perplexity";
      complete: ReturnType<typeof vi.fn>;
      checkAvailability: ReturnType<typeof vi.fn>;
    },
    _config: { apiKey: string }
  ) {
    this.name = "perplexity";
    this.complete = vi.fn();
    this.checkAvailability = mockPerplexityCheckAvailability;
  });

  return {
    mockOpenAICheckAvailability,
    mockGeminiCheckAvailability,
    mockAnthropicCheckAvailability,
    mockPerplexityCheckAvailability,
    openAIConstructorError,
    MockOpenAIProvider,
    MockGeminiProvider,
    MockAnthropicProvider,
    MockPerplexityProvider,
  };
});

vi.mock("../../llm/openai.js", () => ({
  OpenAIProvider: MockOpenAIProvider,
}));

vi.mock("../../llm/gemini.js", () => ({
  GeminiProvider: MockGeminiProvider,
  GeminiProviderConfigSchema: {},
}));

vi.mock("../../llm/anthropic.js", () => ({
  AnthropicProvider: MockAnthropicProvider,
  AnthropicModelSchema: {},
}));

vi.mock("../../llm/perplexity.js", () => ({
  PerplexityProvider: MockPerplexityProvider,
  PerplexityModelSchema: {},
}));

// Import after mocks are set up
import {
  supportsEmbeddings,
  createCompletionProvider,
  createEmbeddingProvider,
  createFullProvider,
  getEmbeddingProvider,
  getAvailableProviders,
  checkProviderAvailability,
} from "../../llm/index.js";
import { OpenAIProvider } from "../../llm/openai.js";
import { GeminiProvider } from "../../llm/gemini.js";
import { AnthropicProvider } from "../../llm/anthropic.js";
import { PerplexityProvider } from "../../llm/perplexity.js";

// =============================================================================
// Tests
// =============================================================================

describe("LLM Index Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set default mock implementations
    mockOpenAICheckAvailability.mockResolvedValue({ available: true });
    mockGeminiCheckAvailability.mockResolvedValue({ available: true });
    mockAnthropicCheckAvailability.mockResolvedValue({ available: true });
    mockPerplexityCheckAvailability.mockResolvedValue({ available: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // supportsEmbeddings
  // ===========================================================================

  describe("supportsEmbeddings", () => {
    it("should return true for openai", () => {
      expect(supportsEmbeddings("openai")).toBe(true);
    });

    it("should return true for gemini", () => {
      expect(supportsEmbeddings("gemini")).toBe(true);
    });

    it("should return false for anthropic", () => {
      expect(supportsEmbeddings("anthropic")).toBe(false);
    });

    it("should return false for perplexity", () => {
      expect(supportsEmbeddings("perplexity")).toBe(false);
    });

    it("should return false for claude-code", () => {
      expect(supportsEmbeddings("claude-code")).toBe(false);
    });

    it("should return false for codex", () => {
      expect(supportsEmbeddings("codex")).toBe(false);
    });
  });

  // ===========================================================================
  // createCompletionProvider
  // ===========================================================================

  describe("createCompletionProvider", () => {
    const testApiKey = "test-api-key-123";

    it("should create OpenAIProvider for openai type", () => {
      const provider = createCompletionProvider("openai", testApiKey);

      expect(OpenAIProvider).toHaveBeenCalledWith(testApiKey);
      expect(provider.name).toBe("openai");
    });

    it("should create GeminiProvider for gemini type", () => {
      const provider = createCompletionProvider("gemini", testApiKey);

      expect(GeminiProvider).toHaveBeenCalledWith({ apiKey: testApiKey });
      expect(provider.name).toBe("gemini");
    });

    it("should create AnthropicProvider for anthropic type", () => {
      const provider = createCompletionProvider("anthropic", testApiKey);

      expect(AnthropicProvider).toHaveBeenCalledWith(testApiKey);
      expect(provider.name).toBe("anthropic");
    });

    it("should create PerplexityProvider for perplexity type", () => {
      const provider = createCompletionProvider("perplexity", testApiKey);

      expect(PerplexityProvider).toHaveBeenCalledWith({ apiKey: testApiKey });
      expect(provider.name).toBe("perplexity");
    });

    it("should throw error for claude-code type", () => {
      expect(() => createCompletionProvider("claude-code", testApiKey)).toThrow(
        "claude-code is a CLI provider and must be created via createCLICompletionAdapter, not through factory"
      );
    });

    it("should throw error for codex type", () => {
      expect(() => createCompletionProvider("codex", testApiKey)).toThrow(
        "codex is a CLI provider and must be created via createCLICompletionAdapter, not through factory"
      );
    });
  });

  // ===========================================================================
  // createEmbeddingProvider
  // ===========================================================================

  describe("createEmbeddingProvider", () => {
    const testApiKey = "test-api-key-456";

    it("should create OpenAIProvider for openai type", () => {
      const provider = createEmbeddingProvider("openai", testApiKey);

      expect(OpenAIProvider).toHaveBeenCalledWith(testApiKey);
      expect(provider).toBeDefined();
    });

    it("should create GeminiProvider for gemini type", () => {
      const provider = createEmbeddingProvider("gemini", testApiKey);

      expect(GeminiProvider).toHaveBeenCalledWith({ apiKey: testApiKey });
      expect(provider).toBeDefined();
    });

    it("should throw error for anthropic type", () => {
      expect(() => createEmbeddingProvider("anthropic", testApiKey)).toThrow(
        "anthropic does not support embeddings. Use OpenAI, Gemini, or Jina instead."
      );
    });

    it("should throw error for perplexity type", () => {
      expect(() => createEmbeddingProvider("perplexity", testApiKey)).toThrow(
        "perplexity does not support embeddings. Use OpenAI, Gemini, or Jina instead."
      );
    });

    it("should throw error for claude-code type", () => {
      expect(() => createEmbeddingProvider("claude-code", testApiKey)).toThrow(
        "claude-code does not support embeddings. Use OpenAI, Gemini, or Jina instead."
      );
    });

    it("should throw error for codex type", () => {
      expect(() => createEmbeddingProvider("codex", testApiKey)).toThrow(
        "codex does not support embeddings. Use OpenAI, Gemini, or Jina instead."
      );
    });
  });

  // ===========================================================================
  // createFullProvider
  // ===========================================================================

  describe("createFullProvider", () => {
    const testApiKey = "test-api-key-789";

    it("should create OpenAIProvider for openai type", () => {
      const provider = createFullProvider("openai", testApiKey);

      expect(OpenAIProvider).toHaveBeenCalledWith(testApiKey);
      expect(provider).toBeDefined();
    });

    it("should create GeminiProvider for gemini type", () => {
      const provider = createFullProvider("gemini", testApiKey);

      expect(GeminiProvider).toHaveBeenCalledWith({ apiKey: testApiKey });
      expect(provider).toBeDefined();
    });

    it("should throw error for anthropic type", () => {
      expect(() => createFullProvider("anthropic", testApiKey)).toThrow(
        "anthropic does not support embeddings. Use OpenAI or Gemini for full provider."
      );
    });

    it("should throw error for perplexity type", () => {
      expect(() => createFullProvider("perplexity", testApiKey)).toThrow(
        "perplexity does not support embeddings. Use OpenAI or Gemini for full provider."
      );
    });

    it("should throw error for claude-code type", () => {
      expect(() => createFullProvider("claude-code", testApiKey)).toThrow(
        "claude-code does not support embeddings. Use OpenAI or Gemini for full provider."
      );
    });

    it("should throw error for codex type", () => {
      expect(() => createFullProvider("codex", testApiKey)).toThrow(
        "codex does not support embeddings. Use OpenAI or Gemini for full provider."
      );
    });
  });

  // ===========================================================================
  // getEmbeddingProvider
  // ===========================================================================

  describe("getEmbeddingProvider", () => {
    it("should return preferred provider when available (openai)", () => {
      const config: ProviderFactoryConfig = {
        openaiApiKey: "sk-openai-key",
        geminiApiKey: "gemini-key",
      };

      const provider = getEmbeddingProvider(config, "openai");

      expect(OpenAIProvider).toHaveBeenCalledWith("sk-openai-key");
      expect(provider).toBeDefined();
    });

    it("should return preferred provider when available (gemini)", () => {
      const config: ProviderFactoryConfig = {
        openaiApiKey: "sk-openai-key",
        geminiApiKey: "gemini-key",
      };

      const provider = getEmbeddingProvider(config, "gemini");

      expect(GeminiProvider).toHaveBeenCalledWith({ apiKey: "gemini-key" });
      expect(provider).toBeDefined();
    });

    it("should fallback to openai when preferred not available", () => {
      const config: ProviderFactoryConfig = {
        openaiApiKey: "sk-openai-key",
      };

      const provider = getEmbeddingProvider(config, "gemini");

      expect(OpenAIProvider).toHaveBeenCalledWith("sk-openai-key");
      expect(provider).toBeDefined();
    });

    it("should fallback to gemini when openai not available", () => {
      const config: ProviderFactoryConfig = {
        geminiApiKey: "gemini-key",
      };

      const provider = getEmbeddingProvider(config);

      expect(GeminiProvider).toHaveBeenCalledWith({ apiKey: "gemini-key" });
      expect(provider).toBeDefined();
    });

    it("should throw error when no embedding provider available", () => {
      const config: ProviderFactoryConfig = {
        anthropicApiKey: "anthropic-key",
      };

      expect(() => getEmbeddingProvider(config)).toThrow(
        "No embedding provider available. Configure JINA_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY."
      );
    });

    it("should fallback to openai when anthropic preferred but no embedding support", () => {
      const config: ProviderFactoryConfig = {
        openaiApiKey: "sk-openai-key",
        anthropicApiKey: "anthropic-key",
      };

      const provider = getEmbeddingProvider(config, "anthropic");

      expect(OpenAIProvider).toHaveBeenCalledWith("sk-openai-key");
      expect(provider).toBeDefined();
    });
  });

  // ===========================================================================
  // getAvailableProviders
  // ===========================================================================

  describe("getAvailableProviders", () => {
    it("should return all providers when all keys provided", () => {
      const config: ProviderFactoryConfig = {
        openaiApiKey: "sk-openai",
        geminiApiKey: "gemini-key",
        anthropicApiKey: "anthropic-key",
        perplexityApiKey: "pplx-key",
      };

      const providers = getAvailableProviders(config);

      expect(providers).toContain("openai");
      expect(providers).toContain("gemini");
      expect(providers).toContain("anthropic");
      expect(providers).toContain("perplexity");
      expect(providers).toHaveLength(4);
    });

    it("should return only providers with keys", () => {
      const config: ProviderFactoryConfig = {
        openaiApiKey: "sk-openai",
        geminiApiKey: "gemini-key",
      };

      const providers = getAvailableProviders(config);

      expect(providers).toContain("openai");
      expect(providers).toContain("gemini");
      expect(providers).not.toContain("anthropic");
      expect(providers).not.toContain("perplexity");
      expect(providers).toHaveLength(2);
    });

    it("should return single provider when only one key provided", () => {
      const config: ProviderFactoryConfig = {
        anthropicApiKey: "anthropic-key",
      };

      const providers = getAvailableProviders(config);

      expect(providers).toEqual(["anthropic"]);
    });

    it("should return empty array when no keys provided", () => {
      const config = {} as ProviderFactoryConfig;

      const providers = getAvailableProviders(config);

      expect(providers).toEqual([]);
    });
  });

  // ===========================================================================
  // checkProviderAvailability
  // ===========================================================================

  describe("checkProviderAvailability", () => {
    const testApiKey = "test-api-key";

    it("should return false for claude-code provider", async () => {
      const result = await checkProviderAvailability("claude-code", testApiKey);

      expect(result.available).toBe(false);
      expect(result.error).toBe(
        "claude-code is a CLI provider - use checkCLIAvailability instead"
      );
    });

    it("should return false for codex provider", async () => {
      const result = await checkProviderAvailability("codex", testApiKey);

      expect(result.available).toBe(false);
      expect(result.error).toBe(
        "codex is a CLI provider - use checkCLIAvailability instead"
      );
    });

    it("should call checkAvailability for openai provider", async () => {
      const result = await checkProviderAvailability("openai", testApiKey);

      expect(OpenAIProvider).toHaveBeenCalledWith(testApiKey);
      expect(mockOpenAICheckAvailability).toHaveBeenCalled();
      expect(result.available).toBe(true);
    });

    it("should call checkAvailability for gemini provider", async () => {
      const result = await checkProviderAvailability("gemini", testApiKey);

      expect(GeminiProvider).toHaveBeenCalledWith({ apiKey: testApiKey });
      expect(mockGeminiCheckAvailability).toHaveBeenCalled();
      expect(result.available).toBe(true);
    });

    it("should call checkAvailability for anthropic provider", async () => {
      const result = await checkProviderAvailability("anthropic", testApiKey);

      expect(AnthropicProvider).toHaveBeenCalledWith(testApiKey);
      expect(mockAnthropicCheckAvailability).toHaveBeenCalled();
      expect(result.available).toBe(true);
    });

    it("should call checkAvailability for perplexity provider", async () => {
      const result = await checkProviderAvailability("perplexity", testApiKey);

      expect(PerplexityProvider).toHaveBeenCalledWith({ apiKey: testApiKey });
      expect(mockPerplexityCheckAvailability).toHaveBeenCalled();
      expect(result.available).toBe(true);
    });

    it("should handle provider unavailability", async () => {
      mockOpenAICheckAvailability.mockResolvedValueOnce({
        available: false,
        error: "Invalid API key",
      });

      const result = await checkProviderAvailability("openai", testApiKey);

      expect(result.available).toBe(false);
      expect(result.error).toBe("Invalid API key");
    });

    it("should handle errors during provider creation", async () => {
      openAIConstructorError.value = new Error("Failed to initialize provider");

      const result = await checkProviderAvailability("openai", testApiKey);

      expect(result.available).toBe(false);
      expect(result.error).toBe("Failed to initialize provider");
    });

    it("should handle unknown errors gracefully", async () => {
      openAIConstructorError.value = "Unknown error string";

      const result = await checkProviderAvailability("openai", testApiKey);

      expect(result.available).toBe(false);
      expect(result.error).toBe("Unknown error");
    });
  });

  // ===========================================================================
  // Type Safety Tests
  // ===========================================================================

  describe("type safety", () => {
    it("should correctly narrow type with supportsEmbeddings", () => {
      const providerType: LLMProviderType = "openai";

      if (supportsEmbeddings(providerType)) {
        // TypeScript should narrow this to EmbeddingProviderType
        const embeddingProvider: "openai" | "gemini" = providerType;
        expect(embeddingProvider).toBe("openai");
      }
    });
  });
});

// =============================================================================
// getCompletionProviderWithFallback Tests (separate describe block)
// =============================================================================

// Mock for CLI adapter
const mockCreateCLICompletionAdapter = vi.fn();

vi.mock("../../llm/cli-adapter.js", () => ({
  createCLICompletionAdapter: (...args: unknown[]) =>
    mockCreateCLICompletionAdapter(...args),
  CLICompletionAdapter: vi.fn(),
  checkCLIAvailability: vi.fn(),
}));

// Re-import to get the mocked version
import { getCompletionProviderWithFallback } from "../../llm/index.js";

describe("getCompletionProviderWithFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateCLICompletionAdapter.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return preferred provider when API key is available", async () => {
    const result = await getCompletionProviderWithFallback({
      apiKeys: { openaiApiKey: "sk-test-key" },
      preferredProvider: "openai",
    });

    expect(result.providerType).toBe("openai");
    expect(result.isCLIFallback).toBe(false);
    expect(result.provider).toBeDefined();
  });

  it("should return first available API provider when preferred is not available", async () => {
    const result = await getCompletionProviderWithFallback({
      apiKeys: { geminiApiKey: "gemini-key" },
      preferredProvider: "openai",
    });

    expect(result.providerType).toBe("gemini");
    expect(result.isCLIFallback).toBe(false);
  });

  it("should follow priority order: openai > gemini > anthropic > perplexity", async () => {
    // Only anthropic key available
    const result = await getCompletionProviderWithFallback({
      apiKeys: { anthropicApiKey: "anthropic-key" },
    });

    expect(result.providerType).toBe("anthropic");
    expect(result.isCLIFallback).toBe(false);
  });

  it("should fallback to CLI when no API keys available", async () => {
    const mockCLIAdapter = {
      name: "claude-code" as const,
      complete: vi.fn(),
      checkAvailability: vi.fn(),
    };
    mockCreateCLICompletionAdapter.mockResolvedValue(mockCLIAdapter);

    const result = await getCompletionProviderWithFallback({});

    expect(result.providerType).toBe("claude-code");
    expect(result.isCLIFallback).toBe(true);
    expect(mockCreateCLICompletionAdapter).toHaveBeenCalled();
  });

  it("should pass projectPath and cliTimeout to CLI adapter", async () => {
    const mockCLIAdapter = {
      name: "claude-code" as const,
      complete: vi.fn(),
      checkAvailability: vi.fn(),
    };
    mockCreateCLICompletionAdapter.mockResolvedValue(mockCLIAdapter);

    await getCompletionProviderWithFallback({
      projectPath: "/test/project",
      cliTimeout: 60000,
    });

    expect(mockCreateCLICompletionAdapter).toHaveBeenCalledWith(
      "/test/project",
      60000
    );
  });

  it("should throw error when no provider is available", async () => {
    mockCreateCLICompletionAdapter.mockResolvedValue(null);

    await expect(getCompletionProviderWithFallback({})).rejects.toThrow(
      "No completion provider available"
    );
  });

  it("should handle empty config", async () => {
    const mockCLIAdapter = {
      name: "claude-code" as const,
      complete: vi.fn(),
      checkAvailability: vi.fn(),
    };
    mockCreateCLICompletionAdapter.mockResolvedValue(mockCLIAdapter);

    const result = await getCompletionProviderWithFallback();

    expect(result.isCLIFallback).toBe(true);
  });

  it("should try next provider if creation fails", async () => {
    // Setup: OpenAI will fail (constructor throws), Gemini should work
    openAIConstructorError.value = new Error("OpenAI init failed");

    const result = await getCompletionProviderWithFallback({
      apiKeys: {
        openaiApiKey: "sk-failing-key",
        geminiApiKey: "gemini-working-key",
      },
    });

    expect(result.providerType).toBe("gemini");
    expect(result.isCLIFallback).toBe(false);
  });
});
