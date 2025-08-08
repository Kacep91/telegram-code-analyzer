# 🤖 Telegram Code Analyzer

**Minimalist Telegram bot** that provides codebase analysis using Claude Code CLI. Ask questions through Telegram and get markdown analysis files.

## 🎯 What it does

Simple Telegram bot for code analysis conversations. Send questions → get analysis results as files. **No database, no complex architecture, no overengineering.**

## ✨ Key Features

- **Natural language queries** - Ask questions about your codebase  
- **Claude analysis** - Uses Claude Code CLI for code insights
- **Whitelist access** - Simple authorization via Telegram user IDs
- **File responses** - Analysis delivered as markdown documents
- **KISS architecture** - Maximum simplicity, minimum complexity

## Quick Start

### Prerequisites

- Node.js 18 or higher
- Claude Code CLI (installed via npm or locally)
- Telegram Bot Token (from @BotFather)
- Your Telegram user ID

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd telegram-code-analyzer
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Install Claude Code CLI**
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

5. **Build and run**
   ```bash
   npm run build
   npm start
   ```

   For development:
   ```bash
   npm run dev
   ```

## Configuration

Create a `.env` file with the following settings:

```env
# Get this from @BotFather on Telegram
TELEGRAM_TOKEN=your_telegram_bot_token_here

# Your Telegram user IDs (comma-separated)
AUTHORIZED_USERS=123456789,987654321

# Path to the project you want to analyze
PROJECT_PATH=/path/to/your/project

# Analysis timeout in milliseconds (5 minutes default)
CLAUDE_TIMEOUT=300000

# Claude CLI path (optional, auto-detected if not specified)
CLAUDE_PATH=/Users/username/.claude/local/claude

# Logging level
LOG_LEVEL=INFO
```

### Getting Your Telegram User ID

1. Start a chat with @userinfobot on Telegram
2. Send any message to get your user ID
3. Add this ID to `AUTHORIZED_USERS` in your `.env` file

## Usage

Once the bot is running, interact with it through Telegram:

### Basic Commands

- `/start` - Welcome message and capabilities overview
- `/help` - Usage guide and example questions

### Analysis Examples

Simply send these as regular messages to the bot:

```
Explain the project architecture

How does the authentication system work?

Find potential security vulnerabilities

Analyze the database schema design

What are the main performance bottlenecks?

Review the error handling patterns

Suggest improvements for the API structure
```

### Response Format

The bot provides two types of responses:

1. **Quick summary** - Brief overview sent directly to chat
2. **Detailed analysis** - Comprehensive markdown file attached as document

## How It Works

1. **Question Processing** - Your question is combined with analysis prompts
2. **Claude Analysis** - Claude Code CLI analyzes your codebase with the question
3. **Response Generation** - Results are formatted and saved as markdown
4. **Delivery** - Summary sent to chat, detailed file attached as document

## 🏗️ Technology Stack

**Minimal dependencies for maximum simplicity:**

- **Runtime**: Node.js 18+
- **Language**: TypeScript 
- **Bot**: grammY (Telegram Bot API)
- **AI**: Claude Code CLI
- **Config**: dotenv
- **Architecture**: File system only, **no database, no DI, no patterns**

**Philosophy**: Simple functions over complex abstractions

## Development

### Available Scripts

```bash
npm run dev         # Development mode with tsx
npm run build       # TypeScript compilation  
npm start          # Production mode
npm run type-check # Type checking only
npm run clean      # Remove build files
```

### 📁 Project Structure

**Simplified architecture after radical cleanup:**

```
src/
├── index.ts      # Entry point (60 lines)
├── bot.ts        # Telegram bot handlers  
├── auth.ts       # Simple whitelist check
├── claude.ts     # Claude CLI integration
├── utils.ts      # Basic utilities
├── validation.ts # Input validation
└── types.ts      # Essential types only

temp/             # Analysis results
prompts/          # Analysis prompts
```

**Removed**: `container.ts`, `interfaces/`, `guards.ts`, `errors/handler.ts`, `errors/strategies.ts` (1,757 lines of overengineering)

## Deployment

### Simple Deployment

1. Set up a VPS with Node.js 18+
2. Clone and configure the project
3. Install dependencies and build
4. Run the bot:

```bash
npm run build
npm start
```

For background execution, use nohup or screen:

```bash
nohup npm start > bot.log 2>&1 &
```

### Docker Alternative

While the project is designed to run directly on the host for simplicity, you can containerize it if needed. The file system approach and direct CLI integration work best in standard Node.js environments.

## Security

- **Access Control**: Only whitelisted Telegram user IDs can use the bot
- **Input Validation**: All user inputs are validated and sanitized
- **No Data Persistence**: Analysis results are temporary and cleaned up automatically
- **Secure Configuration**: All sensitive data stored in environment variables

## Troubleshooting

### Common Issues

**"Claude CLI not found"**
- Install Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
- Or specify custom path in `CLAUDE_PATH` environment variable

**"Analysis timeout"**
- Increase `CLAUDE_TIMEOUT` value in `.env`
- Try asking more specific questions
- Ensure your project path is accessible

**"Unauthorized access"**  
- Verify your Telegram user ID in `AUTHORIZED_USERS`
- Check that the bot token is correct
- Ensure the bot is running and accessible

## Keywords

`telegram-bot` `code-analysis` `claude-ai` `typescript` `nodejs` `code-review` `static-analysis` `codebase-analyzer` `ai-code-review` `claude-code-cli` `grammy` `telegram-api` `code-quality` `software-architecture` `developer-tools` `code-insights` `automated-review` `ai-assistant` `programming-tools` `codebase-exploration`

## 🚀 Contributing

**ULTRA-MINIMALIST APPROACH**

✅ **KISS over complexity** - Simple functions over classes/patterns  
✅ **Delete over add** - Remove code rather than add features  
✅ **Plain over fancy** - Direct solutions over abstractions  
✅ **Occam's Razor** - Simplest solution that works  

**Before adding anything**: Ask "Is this really necessary for 5 users?"