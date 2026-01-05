# Telegram Code Analyzer

Telegram bot for codebase analysis using RAG (Retrieval-Augmented Generation) and Claude Code CLI.

## Features

- **RAG-powered analysis** - Semantic code search with LLM reranking
- **Multi-LLM support** - OpenAI, Gemini, Anthropic, Perplexity
- **Claude Code CLI** - Deep codebase analysis via sub-agents
- **Telegram interface** - Natural language queries
- **Whitelist auth** - Access control via Telegram user IDs

## Requirements

- **Node.js 18+** (LTS recommended, tested on v22)
- **npm 9+** or yarn/pnpm
- **Claude Code CLI** (optional, for deep analysis)

### Installation

1. Install Node.js 18+ from https://nodejs.org/
2. Clone repository and install dependencies:
   ```bash
   git clone <repository-url>
   cd telegram-code-analyzer
   npm install
   ```
3. (Optional) Install Claude Code CLI:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

## Quick Start

```bash
# 1. Clone and install
git clone <repository-url>
cd telegram-code-analyzer
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your tokens

# 3. Build and run
npm run build
npm start
```

## Configuration

```env
# Required
TELEGRAM_TOKEN=your_bot_token
AUTHORIZED_USERS=123456789,987654321
PROJECT_PATH=/path/to/analyze

# LLM Providers (at least one required for RAG)
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
PERPLEXITY_API_KEY=...

# Optional
CLAUDE_TIMEOUT=300000
LOG_LEVEL=INFO
```

## Usage

### Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Usage guide |
| `/index` | Index codebase for RAG |
| `/ask <question>` | Query indexed codebase |
| `/provider [name]` | View/switch LLM provider |

### Analysis Modes

**RAG Query** (`/ask`): Fast semantic search through indexed code
```
/ask How does authentication work?
/ask Find all API endpoints
```

**Claude Code Analysis** (regular messages): Deep analysis via CLI
```
Explain the project architecture
Find security vulnerabilities
Review error handling patterns
```

## How RAG Works

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                  INDEXING PHASE                     │
├─────────────────────────────────────────────────────┤
│  .ts/.tsx files                                     │
│       ↓                                             │
│  AST Parser (extract functions, classes, types)    │
│       ↓                                             │
│  Chunker (semantic splitting with overlap)         │
│       ↓                                             │
│  Embedding Provider (OpenAI/Gemini)                │
│       ↓                                             │
│  Vector Store (in-memory + JSON persistence)       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                   QUERY PHASE                       │
├─────────────────────────────────────────────────────┤
│  User Question                                      │
│       ↓                                             │
│  Query Embedding                                    │
│       ↓                                             │
│  Vector Search (cosine similarity, top-K)          │
│       ↓                                             │
│  LLM Reranking (score relevance 0-1)               │
│       ↓                                             │
│  Parent Chunk Resolution (add context)             │
│       ↓                                             │
│  Answer Generation (with sources)                  │
└─────────────────────────────────────────────────────┘
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| Parser | `src/rag/parser.ts` | TypeScript AST parsing, entity extraction |
| Chunker | `src/rag/chunker.ts` | Semantic code splitting with overlap |
| Store | `src/rag/store.ts` | In-memory vector store, JSON persistence |
| Retriever | `src/rag/retriever.ts` | Two-stage search: vector + LLM rerank |
| Pipeline | `src/rag/pipeline.ts` | Orchestrates index/query operations |

### Full Request Flow

```
User sends message to Telegram
            │
            ▼
    Input Validation (Zod)
            │
            ▼
    ┌───────┴───────┐
    │               │
  /ask          Regular msg
    │               │
    ▼               ▼
RAG Pipeline    Claude Code CLI
    │               │
    ▼               │
Vector Search       │
(top-15 chunks)     │
    │               │
    ▼               │
LLM Reranking       │
(score 0-1)         │
    │               │
    ▼               │
Context Assembly    │
(parent chunks)     │
    │               │
    ▼               ▼
LLM Answer      Analysis Result
Generation          │
    │               │
    └───────┬───────┘
            │
            ▼
    Send to Telegram:
    - Brief summary (message)
    - Detailed .md file (document)
```

### Scoring Formula

Final relevance score combines vector similarity and LLM judgment:

```
finalScore = vectorWeight × vectorScore + llmWeight × llmScore
           = 0.3 × vectorScore + 0.7 × llmScore
```

LLM reranking weighs more heavily to capture semantic relevance beyond keyword matching.

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.9
- **Bot Framework**: grammY
- **Analysis**: Claude Code CLI
- **Embeddings**: OpenAI / Gemini
- **Validation**: Zod

## Development

```bash
npm run dev        # Development mode (tsx)
npm run build      # TypeScript compilation
npm run type-check # Type checking only
npm run test       # Tests (watch mode)
npm run lint       # Check formatting
```

## Troubleshooting

**"Claude CLI not found"** - Install: `npm install -g @anthropic-ai/claude-code`

**"No embedding provider"** - Set `OPENAI_API_KEY` or `GEMINI_API_KEY` in .env

**"Unauthorized"** - Add your Telegram user ID to `AUTHORIZED_USERS`

---

## На русском

Telegram-бот для анализа кодовой базы с использованием RAG и Claude Code CLI.

**Основные возможности:**
- RAG-поиск по коду с LLM-ранжированием
- Поддержка нескольких LLM провайдеров
- Глубокий анализ через Claude Code CLI

**Команды:**
- `/index` - проиндексировать проект
- `/ask <вопрос>` - RAG-запрос по коду
- `/provider` - выбор LLM провайдера
- Обычное сообщение - анализ через Claude Code

Подробная документация: [CLAUDE.md](CLAUDE.md)
