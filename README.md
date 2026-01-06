# Telegram Code Analyzer

Telegram bot for codebase analysis using **RAG** (Retrieval-Augmented Generation) and **multiple LLM providers**.

## Features

- **RAG-powered analysis** — Semantic code search with LLM reranking
- **Multi-LLM support** — OpenAI, Gemini, Anthropic, Perplexity, Jina
- **Telegram interface** — Natural language queries
- **Two-level auth** — Users + Admins (whitelist access control)

## Requirements

- **Node.js 18+** (LTS recommended, tested on v22)
- **npm 9+** or yarn/pnpm

### Installation

1. Install Node.js 18+ from https://nodejs.org/
2. Clone repository and install dependencies:
   ```bash
   git clone <repository-url>
   cd telegram-code-analyzer
   npm install
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
# =============================================================================
# Telegram Bot (Required)
# =============================================================================
TELEGRAM_BOT_TOKEN=your_bot_token
AUTHORIZED_USERS=123456789,987654321    # Comma-separated Telegram user IDs
ADMIN_USERS=123456789                    # Admins can run /index command
PROJECT_PATH=/path/to/analyze

# =============================================================================
# LLM Providers (at least one required for RAG embeddings)
# =============================================================================
# Embeddings providers (pick one)
OPENAI_API_KEY=sk-...                   # Recommended for embeddings
GEMINI_API_KEY=AIza...                  # Alternative embeddings
JINA_API_KEY=jina_...                   # Code-optimized embeddings

# Completions providers (for answer generation)
ANTHROPIC_API_KEY=sk-ant-...            # High quality, no embeddings
PERPLEXITY_API_KEY=pplx-...             # No embeddings

# Default provider for completions
DEFAULT_LLM_PROVIDER=openai              # openai|gemini|anthropic|perplexity

# =============================================================================
# RAG Settings (Optional)
# =============================================================================
RAG_STORE_PATH=./rag-index              # Index storage path
# RAG_CHUNK_SIZE=300                     # Tokens per chunk
# RAG_CHUNK_OVERLAP=50                   # Overlap between chunks
# RAG_TOP_K=15                           # Candidates for vector search
# RAG_RERANK_TOP_K=5                     # Final results after reranking
# RAG_VECTOR_WEIGHT=0.3                  # Vector similarity weight
# RAG_LLM_WEIGHT=0.7                     # LLM reranking weight

# =============================================================================
# Logging
# =============================================================================
LOG_LEVEL=INFO                           # DEBUG|INFO|WARN|ERROR
```

## Authorization & Admins

| Variable | Description |
|----------|-------------|
| `AUTHORIZED_USERS` | Comma-separated Telegram user IDs with access to the bot |
| `ADMIN_USERS` | Admins with access to `/index` command. Auto-authorized (no need to add to AUTHORIZED_USERS) |

**Get your Telegram ID**: Send `/start` to [@userinfobot](https://t.me/userinfobot)

## Usage

### Bot Commands

| Command | Access | Description |
|---------|--------|-------------|
| `/start` | Users | Welcome message and bot info |
| `/help` | Users | Usage guide and available providers |
| `/index` | **Admins only** | Index codebase for RAG search |
| `/ask <question>` | Users | RAG query to indexed codebase |
| `/status` | Users | Show system status (index, provider) |

### Analysis Modes

**RAG Query** (`/ask`): Fast semantic search through indexed code
```
/ask How does authentication work?
/ask Find all API endpoints
/ask What validation is used?
```

## LLM Providers

### Embeddings (for RAG indexing and search)

| Provider | Model | API Key | Notes |
|----------|-------|---------|-------|
| **OpenAI** | `text-embedding-3-large` | `OPENAI_API_KEY` | Recommended, 3072 dimensions |
| **Gemini** | `text-embedding-004` | `GEMINI_API_KEY` | Good alternative |
| **Jina** | `jina-embeddings-v3` | `JINA_API_KEY` | Optimized for code |

### Completions (for answer generation and reranking)

| Provider | Model | API Key | Notes |
|----------|-------|---------|-------|
| **OpenAI** | `gpt-4.1-mini` | `OPENAI_API_KEY` | Fast, cost-effective |
| **Gemini** | `gemini-2.0-flash` | `GEMINI_API_KEY` | Fast alternative |
| **Anthropic** | `claude-sonnet-4-5` | `ANTHROPIC_API_KEY` | Highest quality |
| **Perplexity** | `sonar-pro` | `PERPLEXITY_API_KEY` | Web-augmented |

> **Important**: Anthropic and Perplexity do NOT support embeddings. Use OpenAI, Gemini, or Jina for RAG indexing.

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
    Auth Middleware (whitelist check)
            │
            ▼
    Input Validation (Zod)
            │
            ▼
    ┌───────┼───────┬───────────┐
    │       │       │           │
  /ask   /index  /status    /help
    │       │       │           │
    ▼       ▼       ▼           ▼
   RAG    Index   System     Help
 Pipeline  Build   Status    Info
    │       │       │           │
    ▼       │       │           │
Vector      │       │           │
Search      │       │           │
(top-K)     │       │           │
    │       │       │           │
    ▼       │       │           │
LLM         │       │           │
Reranking   │       │           │
    │       │       │           │
    ▼       │       │           │
Context     │       │           │
Assembly    │       │           │
    │       │       │           │
    ▼       ▼       ▼           ▼
    └───────┴───────┴───────────┘
                │
                ▼
        Send to Telegram:
        - Brief summary (message)
        - Detailed .md file (if applicable)
```

### Scoring Formula

Final relevance score combines vector similarity and LLM judgment:

```
finalScore = vectorWeight × vectorScore + llmWeight × llmScore
           = 0.3 × vectorScore + 0.7 × llmScore
```

LLM reranking weighs more heavily to capture semantic relevance beyond keyword matching.

## Documentation Support (ai-docs/)

RAG indexes not only code but also documentation from `ai-docs/` folder. This enables comparing "as designed" vs "as implemented".

### Folder Structure

```
ai-docs/
├── prd/           # Product Requirements Documents (PRD/ТЗ)
│   ├── PRD-001-feature-name.md
│   └── PRD-002-another-feature.md
├── adr/           # Architecture Decision Records
│   ├── ADR-001-framework-choice.md
│   └── ADR-002-database-design.md
├── api/           # API Specifications
│   ├── API-auth-endpoints.md
│   └── API-user-management.md
└── notes/         # Analysis & Research Notes
    ├── ANALYSIS-performance-review.md
    └── RESEARCH-llm-providers.md
```

### Naming Conventions

| Prefix | Type | Description |
|--------|------|-------------|
| `PRD-` | prd | Product Requirements Document |
| `ADR-` | adr | Architecture Decision Record |
| `API-` | api | API specification |
| `SPEC-` | api | Technical specification |
| `ANALYSIS-` | notes | Analysis document |
| `RESEARCH-` | notes | Research notes |
| `NOTES-` | notes | General notes |

### Document Format

Frontmatter is **optional** — document type is auto-detected from folder path and filename prefix.

```markdown
---
type: prd                    # Optional: overrides auto-detection
status: accepted             # Optional: draft | review | accepted | deprecated
date: 2024-01-15             # Optional: for tracking
---

# PRD-001: Feature Name

## Summary
Brief description...

## Requirements
1. Requirement one
2. Requirement two
```

**Auto-detection priority:**
1. Frontmatter `type` field (if present)
2. Folder name: `prd/` → prd, `adr/` → adr, `api/` → api
3. Filename prefix: `PRD-`, `ADR-`, `API-`, etc.
4. Default: `notes`

### Comparing Code vs Requirements

```
/ask Does auth implementation match PRD requirements?
/ask What requirements are not yet implemented?
/ask Compare actual API with spec
```

RAG finds both code and documentation — Claude compares and identifies discrepancies.

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.9
- **Bot Framework**: grammY
- **LLM Providers**: OpenAI, Gemini, Anthropic, Perplexity, Jina
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

| Error | Solution |
|-------|----------|
| "No embedding provider" | Set `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `JINA_API_KEY` in .env |
| "Unauthorized" | Add your Telegram user ID to `AUTHORIZED_USERS` |
| "Only admins can run indexing" | Add your ID to `ADMIN_USERS` in .env |
| "Index not found" | Run `/index` first (admins only) |

---

## На русском

Telegram-бот для анализа кодовой базы с использованием **RAG** и **нескольких LLM-провайдеров**.

### Возможности

- **RAG-анализ** — семантический поиск по коду с LLM-ранжированием
- **Мульти-LLM** — OpenAI, Gemini, Anthropic, Perplexity, Jina
- **Telegram-интерфейс** — запросы на естественном языке
- **Двухуровневая авторизация** — пользователи + администраторы

### Требования

- **Node.js 18+** (рекомендуется LTS, тестировалось на v22)
- **npm 9+** или yarn/pnpm

### Быстрый старт

```bash
# 1. Клонирование и установка
git clone <repository-url>
cd telegram-code-analyzer
npm install

# 2. Конфигурация
cp .env.example .env
# Отредактируйте .env, добавив токены

# 3. Сборка и запуск
npm run build
npm start
```

### Конфигурация

```env
# Telegram Bot (Обязательно)
TELEGRAM_BOT_TOKEN=токен_бота
AUTHORIZED_USERS=123456789,987654321    # Telegram ID пользователей
ADMIN_USERS=123456789                    # Админы (доступ к /index)
PROJECT_PATH=/путь/к/проекту

# LLM-провайдеры (минимум один для embeddings)
OPENAI_API_KEY=sk-...                   # Рекомендуется
GEMINI_API_KEY=AIza...                  # Альтернатива
JINA_API_KEY=jina_...                   # Оптимизирован для кода

# Для генерации ответов
ANTHROPIC_API_KEY=sk-ant-...            # Высокое качество, без embeddings
PERPLEXITY_API_KEY=pplx-...             # Без embeddings

DEFAULT_LLM_PROVIDER=openai
```

### Авторизация и администраторы

| Переменная | Описание |
|------------|----------|
| `AUTHORIZED_USERS` | Telegram ID пользователей с доступом к боту |
| `ADMIN_USERS` | Админы с доступом к `/index`. Автоматически авторизованы |

**Узнать свой Telegram ID**: Отправьте `/start` боту [@userinfobot](https://t.me/userinfobot)

### Команды бота

| Команда | Доступ | Описание |
|---------|--------|----------|
| `/start` | Пользователи | Приветствие и информация о боте |
| `/help` | Пользователи | Справка и список провайдеров |
| `/index` | **Только админы** | Индексация кодовой базы для RAG |
| `/ask <вопрос>` | Пользователи | RAG-запрос к индексу |
| `/status` | Пользователи | Статус системы (индекс, провайдер) |

### Режимы анализа

**RAG-запрос** (`/ask`): Быстрый семантический поиск по индексу
```
/ask Как работает авторизация?
/ask Найди все API endpoints
/ask Какая валидация используется?
```

### LLM-провайдеры

#### Embeddings (для индексации и поиска)

| Провайдер | Модель | API Key | Примечания |
|-----------|--------|---------|------------|
| **OpenAI** | `text-embedding-3-large` | `OPENAI_API_KEY` | Рекомендуется |
| **Gemini** | `text-embedding-004` | `GEMINI_API_KEY` | Альтернатива |
| **Jina** | `jina-embeddings-v3` | `JINA_API_KEY` | Для кода |

#### Completions (для генерации ответов)

| Провайдер | Модель | API Key | Примечания |
|-----------|--------|---------|------------|
| **OpenAI** | `gpt-4.1-mini` | `OPENAI_API_KEY` | Быстрый |
| **Gemini** | `gemini-2.0-flash` | `GEMINI_API_KEY` | Быстрый |
| **Anthropic** | `claude-sonnet-4-5` | `ANTHROPIC_API_KEY` | Лучшее качество |
| **Perplexity** | `sonar-pro` | `PERPLEXITY_API_KEY` | С веб-поиском |

> **Важно**: Anthropic и Perplexity НЕ поддерживают embeddings. Используйте OpenAI, Gemini или Jina для индексации.

### Как работает RAG

```
┌─────────────────────────────────────────────────────┐
│                 ФАЗА ИНДЕКСАЦИИ                     │
├─────────────────────────────────────────────────────┤
│  .ts/.tsx файлы                                     │
│       ↓                                             │
│  AST Parser (извлечение функций, классов, типов)   │
│       ↓                                             │
│  Chunker (семантическое разбиение с перекрытием)   │
│       ↓                                             │
│  Embedding Provider (OpenAI/Gemini/Jina)           │
│       ↓                                             │
│  Vector Store (in-memory + JSON persistence)       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                   ФАЗА ЗАПРОСА                      │
├─────────────────────────────────────────────────────┤
│  Вопрос пользователя                                │
│       ↓                                             │
│  Query Embedding                                    │
│       ↓                                             │
│  Vector Search (cosine similarity, top-K)          │
│       ↓                                             │
│  LLM Reranking (оценка релевантности 0-1)          │
│       ↓                                             │
│  Parent Chunk Resolution (добавление контекста)    │
│       ↓                                             │
│  Генерация ответа (с источниками)                  │
└─────────────────────────────────────────────────────┘
```

### Формула скоринга

```
finalScore = vectorWeight × vectorScore + llmWeight × llmScore
           = 0.3 × vectorScore + 0.7 × llmScore
```

LLM-ранжирование имеет больший вес для захвата семантической релевантности.

### Поддержка документации (ai-docs/)

RAG индексирует не только код, но и документацию из папки `ai-docs/`. Это позволяет сравнивать "как спроектировано" vs "как реализовано".

#### Структура папки

```
ai-docs/
├── prd/           # Технические задания (PRD/ТЗ)
│   ├── PRD-001-название-фичи.md
│   └── PRD-002-другая-фича.md
├── adr/           # Architecture Decision Records
│   ├── ADR-001-выбор-фреймворка.md
│   └── ADR-002-дизайн-базы.md
├── api/           # API спецификации
│   └── API-auth-endpoints.md
└── notes/         # Аналитика и заметки
    └── ANALYSIS-обзор-производительности.md
```

#### Naming Conventions

| Префикс | Тип | Описание |
|---------|-----|----------|
| `PRD-` | prd | Техническое задание |
| `ADR-` | adr | Архитектурное решение |
| `API-` | api | API спецификация |
| `ANALYSIS-` | notes | Аналитика |
| `RESEARCH-` | notes | Исследование |

#### Формат документа

Frontmatter **опционален** — тип определяется автоматически по папке и префиксу файла.

```markdown
---
type: prd                    # Опционально: переопределяет авто-определение
status: accepted             # Опционально: draft | review | accepted | deprecated
---

# PRD-001: Название фичи
## Требования
...
```

**Приоритет авто-определения:**
1. Поле `type` в frontmatter (если есть)
2. Имя папки: `prd/` → prd, `adr/` → adr
3. Префикс файла: `PRD-`, `ADR-`, `API-`
4. По умолчанию: `notes`

#### Сравнение "как есть" vs "как должно быть"

```
/ask Соответствует ли авторизация требованиям из PRD?
/ask Какие требования ещё не реализованы?
/ask Сравни API с документацией
```

RAG найдёт и код, и документацию — Claude сравнит и укажет расхождения.

### Разработка

```bash
npm run dev        # Режим разработки (tsx)
npm run build      # Компиляция TypeScript
npm run type-check # Проверка типов
npm run test       # Тесты (watch mode)
npm run lint       # Проверка форматирования
```

### Решение проблем

| Ошибка | Решение |
|--------|---------|
| "No embedding provider" | Установите `OPENAI_API_KEY`, `GEMINI_API_KEY` или `JINA_API_KEY` |
| "Unauthorized" | Добавьте Telegram ID в `AUTHORIZED_USERS` |
| "Only admins can run indexing" | Добавьте ID в `ADMIN_USERS` |
| "Index not found" | Выполните `/index` (только для админов) |

Подробная документация: [CLAUDE.md](CLAUDE.md)
