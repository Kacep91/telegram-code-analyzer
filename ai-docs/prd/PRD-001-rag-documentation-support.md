---
type: prd
status: accepted
date: 2024-01-15
author: Developer
---

# PRD-001: RAG Documentation Support

## Summary

Add support for indexing documentation from `ai-docs/` folder in the RAG pipeline. This enables comparing requirements with implementation during code analysis.

## Problem Statement

Current RAG pipeline only indexes TypeScript code. During analysis it's impossible to:
- Compare implementation with requirements from PRD
- Verify code compliance with architecture decisions (ADR)
- Find discrepancies between API specification and implementation

## Goals

1. Index Markdown documents from `ai-docs/`
2. Auto-detect document type (PRD, ADR, API, notes)
3. Enable comparing "as-is" vs "as-designed"

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Parse Markdown files by sections (## headings) | Must |
| FR-2 | Support YAML frontmatter for metadata | Should |
| FR-3 | Auto-detect type from folder and filename prefix | Must |
| FR-4 | Integrate documents into unified RAG index | Must |
| FR-5 | Separate doc-chunks from code-chunks by type | Must |

### Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-1 | Graceful degradation if ai-docs is missing | Must |
| NFR-2 | Index versioning for compatibility | Must |
| NFR-3 | Document naming conventions | Should |

## Technical Design

### Document Types

```typescript
type DocType = "prd" | "adr" | "api" | "notes";
```

### Folder Structure

```
ai-docs/
├── prd/           # Product Requirements Documents
├── adr/           # Architecture Decision Records
├── api/           # API Specifications
└── notes/         # Analysis & Research Notes
```

### Naming Conventions

- `PRD-NNN-description.md` — Product Requirements
- `ADR-NNN-description.md` — Architecture Decisions
- `API-endpoint-name.md` — API Specifications

## Success Metrics

- [ ] Documents are indexed together with code
- [ ] Query `/ask Does code match requirements?` finds both code and PRD
- [ ] Document type is correctly auto-detected
- [ ] Build and tests pass without errors

## Out of Scope

- Document structure validation
- Document versioning
- Auto-generation of documentation from code
