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
├── eslint.config.js            # 📏 Linting configuration
├── .prettierrc.json            # 🎨 Code formatting
├── CLAUDE.md                   # 🤖 AI Instructions
├── PROJECT_STRUCTURE.md        # 📋 This file
├── SUGGESTIONS.md              # 💡 Project suggestions
└── README.md                   # 📚 Installation guide
```

### Source Code (`src/`) - **11 files total**

```
src/
├── index.ts        (36 lines)  # 🚀 Application entry point  
├── bot.ts          (145 lines) # 🤖 Telegram bot handlers
├── auth.ts         (34 lines)  # 🔐 User authorization
├── claude.ts       (222 lines) # 🧠 Claude CLI integration  
├── utils.ts        (275 lines) # 🛠️ Utility functions
├── validation.ts   (249 lines) # 🔒 Input validation & security
├── types.ts        (227 lines) # 🏷️ TypeScript type definitions
├── container.ts    (105 lines) # 📦 Dependency injection
├── errors/
│   ├── index.ts    (262 lines) # ❌ Error handling & messages
│   └── types.ts    (165 lines) # 🏷️ Error type definitions
└── __tests__/
    ├── setup.ts    (22 lines)  # 🧪 Test configuration
    ├── auth.test.ts (125 lines) # 🔐 Authentication tests
    ├── validation.test.ts (308 lines) # 🔒 Validation tests
    ├── utils.test.ts (65 lines) # 🛠️ Utility tests
    └── integration.test.ts (75 lines) # 🧪 Integration tests
```

### Additional Files

```
interfaces/
└── index.ts        (18 lines)  # 🔗 Core interfaces

errors/
├── handler.ts      (573 lines) # 🚨 Error handling strategies  
└── strategies.ts   (342 lines) # 🔄 Recovery strategies
```

### Other Directories

```
temp/                    # 📁 Analysis result files  
├── analysis-*.md        # Generated analyses
└── .gitkeep            

prompts/                 # 📝 Claude prompts
└── code-analyzer.md     # Analysis instructions

src/__tests__/           # 🧪 Tests (to be simplified)
├── auth.test.ts        # (needs rewrite - currently tests libraries)
├── validation.test.ts  # (needs rewrite - tests Zod, not logic)  
└── utils.test.ts       # (needs rewrite - tests Math.floor)
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

#### `src/container.ts` (105 lines)
Dependency injection container for managing service instances.

#### `src/errors/index.ts` (262 lines)
Centralized error handling with localized messages and error recovery.

#### `src/errors/types.ts` (165 lines)
Error type definitions and classification system.

## 📊 Project Metrics

| Component | Count | Lines |
|-----------|-------|-------|
| **Total TypeScript Files** | 11 | ~2,100 |
| **Core Source Files** | 7 | ~1,188 |
| **Error Handling Files** | 2 | ~427 |
| **Test Files** | 5 | ~595 |
| **Configuration Files** | 4 | - |

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

### `eslint.config.js`
Code linting rules and quality standards.

### `.env`
Environment variables for tokens, user authorization, and configuration.

## 🚀 Development Commands

```bash
npm run dev         # Development mode with tsx
npm run build       # TypeScript compilation  
npm start           # Production start
npm run test        # Run test suite
npm run type-check  # TypeScript type checking
npm run lint        # Code linting
npm run validate    # Input validation tests
```

## 🧪 Testing Strategy

- **Unit Tests**: Individual component testing
- **Integration Tests**: End-to-end workflow testing  
- **Validation Tests**: Input security and validation
- **Authentication Tests**: Authorization system testing

All tests use Vitest framework with TypeScript support.