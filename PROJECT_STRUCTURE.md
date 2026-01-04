# 🤖 Telegram Code Analyzer - Project Structure

Minimalist Telegram bot for codebase analysis using Claude Code CLI capabilities.

## 🏗️ Architecture Overview

Simple Telegram Bot with direct function calls and minimal abstractions.

### Data Flow
```
Telegram User → Auth Check → Claude CLI → File Response
```

### Technology Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Bot Framework**: grammY
- **AI Integration**: Claude Code CLI
- **Configuration**: dotenv
- **Testing**: Vitest
- **Code Quality**: ESLint + Prettier

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
├── SUGGESTIONS.md              # 💡 Project suggestions
└── README.md                   # 📚 Installation guide
```

### Source Code (`src/`) - **12 files total**

```
src/
├── index.ts        (36 lines)  # 🚀 Application entry point
├── bot.ts          (145 lines) # 🤖 Telegram bot handlers
├── auth.ts         (34 lines)  # 🔐 User authorization
├── claude.ts       (222 lines) # 🧠 Claude CLI integration
├── utils.ts        (275 lines) # 🛠️ Utility functions
├── validation.ts   (249 lines) # 🔒 Input validation & security
├── types.ts        (227 lines) # 🏷️ TypeScript type definitions
├── errors/
│   ├── index.ts    (241 lines) # ❌ Error handling & messages
│   └── types.ts    (164 lines) # 🏷️ Error type definitions
└── __tests__/
    ├── setup.ts    (15 lines)  # 🧪 Test configuration
    ├── bot.integration.test.ts (248 lines) # 🤖 Bot integration tests
    └── integration.test.ts (66 lines) # 🧪 Integration tests
```

### Other Directories

```
temp/                    # 📁 Analysis result files  
├── analysis-*.md        # Generated analyses
└── .gitkeep            

prompts/                 # 📝 Claude prompts
└── code-analyzer.md     # Analysis instructions

src/__tests__/           # 🧪 Integration and bot tests
├── bot.integration.test.ts  # Comprehensive bot integration tests
├── integration.test.ts      # End-to-end integration tests
└── setup.ts                 # Test environment configuration
```

## 🧩 File Descriptions

### **Core Files**

#### `src/index.ts` (36 lines)
Application entry point with configuration loading and bot initialization.  

#### `src/bot.ts` (145 lines)
Telegram bot implementation with message handlers and command processing.

#### `src/auth.ts` (34 lines)
User authorization system with whitelist-based access control.

#### `src/claude.ts` (222 lines)
Claude Code CLI integration with subprocess management and result processing.

#### `src/validation.ts` (249 lines)
Input validation and security measures including XSS prevention and rate limiting.

#### `src/utils.ts` (275 lines)
Utility functions for logging, file operations, and configuration management.

#### `src/types.ts` (227 lines)
TypeScript type definitions for the application's data structures and interfaces.

### **Additional Components**

#### `src/errors/index.ts` (241 lines)
Centralized error handling with localized messages and error recovery.

#### `src/errors/types.ts` (164 lines)
Error type definitions and classification system.

## 📊 Project Metrics

| Component | Count | Lines |
|-----------|-------|-------|
| **Total TypeScript Files** | 12 | ~1,922 |
| **Core Source Files** | 7 | ~1,388 |
| **Error Handling Files** | 2 | ~405 |
| **Test Files** | 3 | ~329 |
| **Configuration Files** | 9 | - |

## 🎯 Development Principles

✅ **KISS (Keep It Simple, Stupid)** - Favor simple solutions over complex ones
✅ **Security First** - Input validation and XSS prevention
✅ **Type Safety** - Comprehensive TypeScript usage
✅ **Testability** - Unit and integration test coverage
✅ **Maintainability** - Clear code structure and documentation

## 🔧 Configuration Files

### `package.json`
Project dependencies and scripts configuration.

### `tsconfig.json`
TypeScript compiler configuration with strict type checking.

### `vitest.config.ts`
Test framework configuration for unit and integration tests.

### `.prettierrc.json`
Code formatting rules and style configuration.

### `.env`
Environment variables for tokens, user authorization, and configuration.

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

- **Unit Tests**: Individual component testing
- **Integration Tests**: End-to-end workflow testing  
- **Validation Tests**: Input security and validation
- **Authentication Tests**: Authorization system testing

All tests use Vitest framework with TypeScript support.