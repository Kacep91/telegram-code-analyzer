# 🤖 Telegram Code Analyzer

Minimalist tool for deep codebase analysis via Telegram bot using RAG (Retrieval-Augmented Generation) with multiple LLM providers. Follows KISS principles and Occam's razor for maximum simplicity and development efficiency.

**ALWAYS RESPOND IN ENGLISH**

1. Do what has been asked; nothing more, nothing less.
2. Before you finish, please verify your solution.
3. NEVER create files unless they're absolutely necessary for achieving your goal.
4. ALWAYS prefer editing an existing file to creating a new one.
5. NEVER proactively create documentation files (\*.md) or README files.

## 🏗️ Project Stack

- **Node.js 18+** - runtime environment
- **grammY ^1.37.0** - modern Telegram Bot framework (TypeScript-first)
- **TypeScript ^5.9.2** - static typing for reliability
- **Zod ^4.0.15** - runtime validation and type-safe schemas
- **LLM Providers** - OpenAI, Gemini, Anthropic, Perplexity, Jina for embeddings and completions
- **dotenv ^17.2.1** - environment variables management
- **tsx ^4.20.3** - TypeScript execution for development

## 🏛️ Architecture Principles

**"As simple as possible, but not simpler"**

- **KISS + Occam's Razor**: every new entity must justify its existence
- **Pragmatism**: working solution is more important than "correct" architecture
- **Minimalism**: only what is actually needed
- **File system first**: avoid databases unless absolutely necessary

## 🎯 Core Project Features

1. **RAG Pipeline** - semantic code search with LLM reranking
2. **Multi-LLM Support** - OpenAI, Gemini, Anthropic, Perplexity, Jina
3. **Telegram Interface** - natural communication with the bot
4. **Simple Authorization** - whitelist access system
5. **Structured Responses** - brief summary + detailed .md file

## 📁 Project Structure

```
telegram-code-analyzer/
├── 📄 .env                     # 🔐 Configuration (tokens, users)
├── 📄 package.json             # 📦 Dependencies (grammy, dotenv, tsx)
├── 📄 tsconfig.json            # ⚙️ TypeScript configuration
├── 📂 src/
│   ├── 📄 index.ts             # 🚀 Application entry point
│   ├── 📄 bot.ts               # 🤖 Telegram bot + handlers
│   ├── 📄 auth.ts              # 🔐 Whitelist authorization
│   ├── 📄 utils.ts             # 🛠️ Utilities (logging, config)
│   ├── 📄 validation.ts        # 🔒 Input validation & security
│   ├── 📄 types.ts             # 🏷️ TypeScript types
│   ├── 📂 rag/                 # 🔍 RAG система
│   │   ├── 📄 parser.ts        # AST парсер TypeScript
│   │   ├── 📄 chunker.ts       # Семантическое разбиение
│   │   ├── 📄 store.ts         # Векторное хранилище
│   │   ├── 📄 retriever.ts     # Поиск + ранжирование
│   │   ├── 📄 pipeline.ts      # Оркестратор
│   │   └── 📄 embedding-cache.ts # LRU кеш для embeddings
│   ├── 📂 llm/                 # 🤖 LLM провайдеры
│   │   ├── 📄 *.ts             # OpenAI, Gemini, Anthropic, Perplexity, Jina
│   │   ├── 📄 retry.ts         # Retry with exponential backoff
│   │   └── 📄 fallback.ts      # Provider fallback chain
│   ├── 📂 errors/              # ❌ Error handling
│   │   ├── 📄 index.ts         # Error handling & messages
│   │   └── 📄 types.ts         # Error type definitions
│   └── 📂 __tests__/           # 🧪 Integration tests
│       ├── 📄 setup.ts         # Test configuration
│       ├── 📄 bot.integration.test.ts  # Bot tests
│       └── 📄 integration.test.ts      # Integration tests
└── 📂 temp/                    # 🗂️ Temporary .md responses
```

> 📖 **Detailed Architecture**: Complete component structure in [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)

## 🔍 RAG Pipeline

Все запросы обрабатываются через RAG:

`/ask <вопрос>` → Embedding → Vector Search → LLM Reranking → Answer

| Компонент | Файл | Назначение |
|-----------|------|-----------|
| Parser | `rag/parser.ts` | AST парсинг TypeScript |
| Chunker | `rag/chunker.ts` | Разбиение на чанки |
| Store | `rag/store.ts` | Векторное хранилище |
| Retriever | `rag/retriever.ts` | Поиск + ранжирование (batch size: 5) |
| Pipeline | `rag/pipeline.ts` | Оркестратор (reranking timeout: 90s) |

### Incremental Indexing

Команда `/index` поддерживает инкрементальное индексирование:
- По умолчанию переиндексируются только изменённые файлы
- Обнаружение изменений через SHA256 хеши и mtime
- `/index --full` — принудительное полное переиндексирование

## 🤖 LLM Providers

| Provider | Embeddings | Completions |
|----------|-----------|-------------|
| OpenAI | ✓ | ✓ |
| Gemini | ✓ | ✓ |
| Jina | ✓ | ✗ |
| Anthropic | ✗ | ✓ |
| Perplexity | ✗ | ✓ |

### Retry & Fallback

- **`retryWithBackoff<T>(fn, options)`** — exponential backoff for all providers
  - Options: `maxRetries` (3), `baseDelayMs` (1000), `maxDelayMs` (30000), `signal`, `onRetry`
  - Retries on: 429, 500/502/503/504, timeouts, network errors
- **`CompletionProviderWithFallback`** — tries providers in order until one succeeds
  - Factory: `createFallbackProvider([provider1, provider2, ...])`
- **CLI Fallback** — Claude Code CLI (haiku) used as primary provider when available
  - Falls back to configured API provider (Perplexity, OpenAI, etc.)

### Embedding Cache

- LRU cache for query embeddings (`maxSize: 1000`)
- Single-flight pattern prevents duplicate API calls
- `getStats()` returns `{ size, hits, misses, hitRate }`

## ✅ Verification Checkpoints

**Stop and verify** at these moments:

- After implementing a complete function
- Before starting a new component
- When something seems wrong
- Before declaring "done"

Run verification: `npm run build && npm run type-check && npm run dev`

> Why: This prevents error accumulation and ensures code stability.

## 💻 TypeScript Rules

### PROHIBITED:

- **NO any type** - always use specific TypeScript types!
- **NO hardcoded values** - use constants and config!
- **NO code duplication** - use functions and utilities!
- **NO ignoring errors** - always handle exceptions!
- **NO TODOs** in final code
- **NO exec() calls** - use spawn() for security!
- **NO unvalidated input** - always use Zod schemas!
- **NO backwards-compatibility hacks** - don't rename unused `_vars`, re-export types, or add `// removed` comments

### Mandatory Standards:

- **Type Guards** instead of any type assertions - create isType() functions
- **Zod schemas** for all external data validation
- **Custom error classes** extending Error with proper typing
- **Pure functions** for testability and modularity
- **Async/await** instead of promises where possible
- **Interfaces** for all API contracts and configuration
- **Meaningful names** with predicates (isAuthorized, hasAccess)
- **Early returns** to reduce nesting
- **Typed configurations** - no process.env without validation

### Avoid Over-Engineering:

- Don't add features, refactor code, or make "improvements" beyond what was asked
- Don't add error handling for scenarios that can't happen
- Don't create helpers or abstractions for one-time operations
- Don't design for hypothetical future requirements
- Three similar lines of code is better than a premature abstraction

## 📊 Implementation Standards

### Code is considered ready when:

- ✓ npm run build compiles without errors
- ✓ TypeScript compiles without errors and warnings
- ✓ All Zod schemas validate correctly
- ✓ Error handling follows custom error class pattern
- ✓ No spawn/exec security vulnerabilities
- ✓ Function works end-to-end through Telegram
- ✓ Graceful error handling implemented
- ✓ Code is clear and simple to understand
- ✓ Old/unused code removed
- ✓ Complexity stayed same or reduced (where possible)
- ✓ Code is understandable by junior developer

## 🤝 Problem Solving Together

When stuck or confused:

1. **Stop** - Don't complicate the solution
2. **Step back** - Re-read requirements in PRD
3. **Simplify** - Simple solution is usually correct
4. **Ask** - "I see two approaches: [A] vs [B]. Which is preferable?"

Your improvement ideas are welcome - ask away!

### **Security Always**:

- **Whitelist authorization** via Telegram ID
- **Input sanitization** before processing
- **Timeout limits** for all operations
- **Never log sensitive data** (tokens, user IDs)

## 🛠️ Development Commands

### Main Commands

- `npm run build` - TypeScript compilation
- `npm run dev` - Development mode with tsx
- `npm start` - Production start
- `npm run type-check` - TypeScript type checking
- `npm run lint` - Code formatting check with Prettier
- `npm run lint:fix` - Auto-fix code formatting
- `npm run test` - Run tests in watch mode
- `npm run test:run` - Run tests once (CI mode)

## 🔧 Tool Parallelism

**One message, multiple tools:**

- Multiple Edit tools → One message → All parallel
- Parallel Read → Multiple files simultaneously
- Batch independent operations together

## 🔧 Efficient CLI Commands

```bash
rg -n "pattern" --glob '!node_modules/*'  # Pattern search
fd filename                                 # File finding
tree -L 2 src/                             # Project structure
```

## 🌟 Key Project Features

### RAG System

- **Semantic search**: vector embeddings + LLM reranking
- **Multi-provider**: OpenAI, Gemini, Jina for embeddings; Anthropic, Perplexity for completions
- **AST parsing**: TypeScript-aware code chunking

### Telegram Bot Architecture

- **grammY framework**: modern TypeScript-first approach
- **Simple middleware**: only authorization and error handling
- **File delivery**: sending detailed .md analyses as documents
- **Auto-text handling**: users can send questions directly without /ask
- **Progress animation**: 3-stage progress indicator during query processing
- **InlineKeyboard**: buttons in /start command for quick navigation
- **Graceful shutdown**: SIGINT/SIGTERM handling, waits for indexing to complete
- **IndexingLock**: atomic lock prevents concurrent indexing (TOCTOU fix)
- **All messages in English**: user-facing messages are in English

### Minimal Persistence

- **File system**: analysis results saved to temp/
- **Vector store**: JSON persistence for RAG index
- **Environment config**: all configuration via .env
- **No database**: avoiding database complexity
