# 🤖 Telegram Code Analyzer

Minimalist tool for deep codebase analysis via Telegram bot using powerful Claude Code CLI capabilities. Follows KISS principles and Occam's razor for maximum simplicity and development efficiency.

**ALWAYS RESPOND IN ENGLISH**

1. For maximum efficiency, whenever you need to perform multiple independent operations, invoke all relevant tools simultaneously rather than sequentially.
2. Before you finish, please verify your solution
3. Do what has been asked; nothing more, nothing less.
4. NEVER create files unless they're absolutely necessary for achieving your goal.
5. ALWAYS prefer editing an existing file to creating a new one.
6. NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User.
7. PROJECT STRUCTURE IS IN ./PROJECT_STRUCTURE.md

## 🏗️ Project Stack

- **Node.js 18+** - runtime environment
- **grammY ^1.37.0** - modern Telegram Bot framework (TypeScript-first)
- **TypeScript ^5.9.2** - static typing for reliability
- **Zod ^4.0.15** - runtime validation and type-safe schemas
- **Claude Code CLI** - code analysis core with sub-agents
- **dotenv ^17.2.1** - environment variables management
- **tsx ^4.20.3** - TypeScript execution for development

## 🏛️ Architecture Principles

**"As simple as possible, but not simpler"**

- **KISS + Occam's Razor**: every new entity must justify its existence
- **Pragmatism**: working solution is more important than "correct" architecture
- **Minimalism**: only what is actually needed
- **File system first**: avoid databases unless absolutely necessary

## 🎯 Core Project Features

1. **Code Analysis** - deep analysis through Claude sub-agents
2. **Telegram Interface** - natural communication with the bot
3. **Simple Authorization** - whitelist access system
4. **Structured Responses** - brief summary + detailed .md file

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
│   ├── 📄 claude.ts            # 🧠 Claude Code CLI integration
│   ├── 📄 utils.ts             # 🛠️ Utilities (logging, config)
│   └── 📄 types.ts             # 🏷️ TypeScript types
├── 📂 temp/                    # 🗂️ Temporary .md responses
└── 📂 prompts/                  # 📝 Prompts for Claude sub-agents
    └── 📄 code-analyzer.md      # 🧠 Code analysis prompt
```

> 📖 **Detailed Architecture**: Complete component structure in [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)

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

### Mandatory Standards:

- **Type Guards** instead of any type assertions - create isType() functions
- **Zod schemas** for all external data validation
- **Custom error classes** extending Error with proper typing
- **Dependency injection** for testability and modularity
- **Async/await** instead of promises where possible
- **Interfaces** for all API contracts and configuration
- **Meaningful names** with predicates (isAuthorized, hasAccess)
- **Early returns** to reduce nesting
- **Typed configurations** - no process.env without validation

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

## 🤝 Problem Solving Together

When stuck or confused:

1. **Stop** - Don't complicate the solution
2. **Step back** - Re-read requirements in PRD
3. **Simplify** - Simple solution is usually correct
4. **Ask** - "I see two approaches: [A] vs [B]. Which is preferable?"

Your improvement ideas are welcome - ask away!

### **Security Always**:

- **Zod validation** for all external data (Telegram, CLI, files)
- **spawn() instead of exec()** to prevent command injection
- **Whitelist authorization** via Telegram ID
- **Input sanitization** before processing
- **Timeout limits** for all operations
- **Never log sensitive data** (tokens, user IDs)
- **Graceful error handling** without exposing internals

Avoid complex abstractions or "clever" code. The simple, obvious solution is probably better, and my guidance helps you stay focused on what matters.

## 🛠️ Development Commands

### Main Commands

- `npm run build` - TypeScript compilation
- `npm run dev` - Development mode with tsx
- `npm start` - Production start
- `npm run type-check` - TypeScript type checking
- `npm run lint` - Code quality and security check
- `npm run validate` - Zod schema validation tests

## 🌟 Key Project Features

### Claude Code Integration

- **Sub-agents**: scanner, architect, general-purpose for specialized analysis
- **Simple CLI**: direct claude-code-cli invocation via shell
- **File output**: saving results to .md files

### Telegram Bot Architecture

- **grammY framework**: modern TypeScript-first approach
- **Simple middleware**: only authorization and error handling
- **File delivery**: sending detailed .md analyses as documents

### Minimal Persistence

- **File system**: analysis results saved to temp/
- **Environment config**: all configuration via .env
- **No database**: avoiding database complexity

> 📖 **Technical Documentation**: Detailed component descriptions in [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)

# important-instruction-reminders

Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User.