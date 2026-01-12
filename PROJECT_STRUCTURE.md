# 🤖 Telegram Code Analyzer - Project Structure

Minimalist Telegram bot for codebase analysis using RAG (Retrieval-Augmented Generation) with multiple LLM providers.

## 🏗️ Architecture Overview

RAG-based Telegram Bot with semantic code search, LLM reranking, and provider fallback.

### Data Flow
```
Telegram User → Auth Check → RAG Pipeline → LLM Completion → File Response
                                 ↓
                    Embedding → Vector Search → Reranking
```

### Technology Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Bot Framework**: grammY
- **LLM Providers**: OpenAI, Gemini, Anthropic, Perplexity, Jina
- **CLI Integration**: Claude Code, Codex
- **Configuration**: dotenv + Zod validation
- **Testing**: Vitest
- **Code Quality**: Prettier

## 📁 Project Structure

### Root Directory

```
telegram-code-analyzer/
├── .env                        # 🔐 Environment variables
├── package.json                # 📦 Project dependencies
├── tsconfig.json               # ⚙️ TypeScript configuration
├── vitest.config.ts            # 🧪 Test configuration
├── .prettierrc.json            # 🎨 Code formatting
├── CLAUDE.md                   # 🤖 AI Instructions
├── PROJECT_STRUCTURE.md        # 📋 This file
└── README.md                   # 📚 Installation guide
```

### Source Code (`src/`)

```
src/
├── index.ts          (208 lines)  # 🚀 Application entry point
├── bot.ts            (710 lines)  # 🤖 Telegram bot + handlers
├── auth.ts           (50 lines)   # 🔐 Whitelist authorization
├── claude.ts         (12 lines)   # 🧠 Claude CLI (deprecated)
├── utils.ts          (642 lines)  # 🛠️ Utilities & config
├── validation.ts     (268 lines)  # 🔒 Input validation & security
├── types.ts          (144 lines)  # 🏷️ TypeScript types
│
├── errors/                        # ❌ Error handling
│   └── index.ts      (423 lines)  # Error classes & messages
│
├── cli/                           # 🖥️ CLI adapters
│   ├── index.ts      (91 lines)   # CLI orchestrator
│   ├── claude-code.ts (363 lines) # Claude Code CLI adapter
│   ├── codex.ts      (202 lines)  # Codex CLI adapter
│   ├── path-validator.ts (144 lines) # Path validation
│   └── types.ts      (36 lines)   # CLI type definitions
│
├── llm/                           # 🤖 LLM providers
│   ├── index.ts      (511 lines)  # Provider factory & config
│   ├── types.ts      (148 lines)  # LLM type definitions
│   ├── base.ts       (156 lines)  # Base provider class
│   ├── openai.ts     (296 lines)  # OpenAI provider
│   ├── gemini.ts     (350 lines)  # Gemini provider
│   ├── anthropic.ts  (257 lines)  # Anthropic provider
│   ├── perplexity.ts (219 lines)  # Perplexity provider
│   ├── jina.ts       (199 lines)  # Jina embeddings
│   ├── cli-adapter.ts (227 lines) # CLI as LLM provider
│   ├── retry.ts      (196 lines)  # Exponential backoff
│   ├── fallback.ts   (143 lines)  # Provider fallback chain
│   └── timeout.ts    (89 lines)   # Timeout wrapper
│
├── rag/                           # 🔍 RAG system
│   ├── index.ts      (55 lines)   # RAG exports
│   ├── types.ts      (173 lines)  # RAG type definitions
│   ├── parser.ts     (276 lines)  # AST parser (TypeScript)
│   ├── doc-parser.ts (222 lines)  # Documentation parser
│   ├── chunker.ts    (329 lines)  # Semantic chunking
│   ├── store.ts      (482 lines)  # Vector store (JSON)
│   ├── retriever.ts  (323 lines)  # Search + reranking
│   ├── pipeline.ts   (695 lines)  # RAG orchestrator
│   └── embedding-cache.ts (102 lines) # LRU cache + single-flight
│
└── __tests__/                     # 🧪 Tests
    ├── setup.ts                   # Test configuration
    ├── bot.test.ts                # Bot tests
    ├── auth.test.ts               # Auth tests
    ├── utils.test.ts              # Utils tests
    ├── errors.test.ts             # Error tests
    ├── types.test.ts              # Type tests
    ├── cli/                       # CLI tests
    │   ├── index.test.ts
    │   ├── claude-code.test.ts
    │   ├── codex.test.ts
    │   └── path-validator.test.ts
    ├── llm/                       # LLM tests
    │   ├── index.test.ts
    │   ├── base.test.ts
    │   ├── openai.test.ts
    │   ├── gemini.test.ts
    │   ├── anthropic.test.ts
    │   ├── perplexity.test.ts
    │   ├── jina.test.ts
    │   ├── cli-adapter.test.ts
    │   ├── retry.test.ts
    │   └── fallback.test.ts
    └── rag/                       # RAG tests
        ├── parser.test.ts
        ├── retriever.test.ts
        ├── pipeline.test.ts
        └── embedding-cache.test.ts
```

### Other Directories

```
temp/                    # 📁 Analysis result files
├── analysis-*.md        # Generated analyses
└── .gitkeep

rag-index/               # 📊 RAG index storage
└── rag-index.json       # Vector store data

prompts/                 # 📝 Claude prompts
└── code-analyzer.md     # Analysis instructions
```

## 🧩 Key Components

### **Core Files**

| File | Lines | Description |
|------|-------|-------------|
| `index.ts` | 208 | Entry point, graceful shutdown, indexing lock |
| `bot.ts` | 710 | Telegram handlers, commands, progress animation |
| `auth.ts` | 50 | Whitelist authorization |
| `utils.ts` | 642 | Logging, file ops, config management |
| `validation.ts` | 268 | Zod schemas, XSS prevention |

### **LLM Layer**

| File | Lines | Description |
|------|-------|-------------|
| `llm/index.ts` | 511 | Provider factory, multi-provider config |
| `llm/retry.ts` | 196 | `retryWithBackoff()` - exponential backoff for 429/5xx/timeouts |
| `llm/fallback.ts` | 143 | `CompletionProviderWithFallback` - tries providers in order |
| `llm/timeout.ts` | 89 | `withTimeout()` - configurable operation timeouts |
| `llm/cli-adapter.ts` | 227 | Uses Claude Code CLI as LLM provider |

### **RAG System**

| File | Lines | Description |
|------|-------|-------------|
| `rag/pipeline.ts` | 695 | RAG orchestrator, incremental indexing |
| `rag/retriever.ts` | 323 | Vector search + LLM reranking (batch: 5) |
| `rag/store.ts` | 482 | JSON-based vector store |
| `rag/embedding-cache.ts` | 102 | LRU cache with single-flight deduplication |
| `rag/parser.ts` | 276 | TypeScript AST parsing |
| `rag/chunker.ts` | 329 | Semantic code chunking |

## 📊 Project Metrics

| Component | Files | Lines |
|-----------|-------|-------|
| **Core Source** | 7 | ~2,034 |
| **CLI Adapters** | 5 | ~836 |
| **LLM Providers** | 12 | ~2,791 |
| **RAG System** | 9 | ~2,657 |
| **Error Handling** | 1 | ~423 |
| **Total Source** | 34 | ~8,741 |

## 🎯 Development Principles

- **KISS + Occam's Razor** - Every entity must justify its existence
- **Security First** - Input validation, whitelist auth, XSS prevention
- **Type Safety** - Strict TypeScript, Zod runtime validation
- **Resilience** - Retry with backoff, provider fallback, timeouts
- **Testability** - Comprehensive test coverage

## 🚀 Development Commands

```bash
npm run dev         # Development mode with tsx
npm run build       # TypeScript compilation
npm start           # Production start
npm run test        # Run tests in watch mode
npm run test:run    # Run tests once (CI mode)
npm run type-check  # TypeScript type checking
npm run lint        # Check code formatting
npm run lint:fix    # Auto-fix code formatting
```

## 🧪 Testing Strategy

- **Unit Tests**: Individual component testing (LLM, RAG, CLI)
- **Integration Tests**: End-to-end workflow testing
- **Resilience Tests**: Retry, fallback, timeout behavior
- **Validation Tests**: Input security and Zod schema validation

All tests use Vitest framework with TypeScript support.