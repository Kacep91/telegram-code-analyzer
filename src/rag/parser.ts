import ts from "typescript";
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import type { ChunkType } from "./types.js";
import {
  validatePathWithinBase,
  getAllowedBasePath,
} from "../cli/path-validator.js";
import { getConfigValue } from "../utils.js";

/**
 * Parsed entity from source file
 * Represents a semantic unit extracted via AST parsing
 */
export interface ParsedEntity {
  readonly name: string;
  readonly type: ChunkType;
  readonly code: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly filePath: string;
}

/**
 * Map TypeScript node types to ChunkType
 * Enums and variables are mapped to "constant" as per types.ts schema
 */
function getChunkType(
  node: ts.Node
): Extract<
  ChunkType,
  "function" | "class" | "interface" | "type" | "constant"
> | null {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "constant";
  if (ts.isVariableStatement(node)) return "constant";
  return null;
}

/**
 * Create a ParsedEntity from an AST node
 */
function createEntity(
  node: ts.Node,
  type: ChunkType,
  name: string,
  sourceFile: ts.SourceFile,
  filePath: string
): ParsedEntity {
  const start = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile)
  );
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

  return {
    name,
    type,
    code: node.getText(sourceFile),
    startLine: start.line + 1, // Convert to 1-indexed
    endLine: end.line + 1,
    filePath,
  };
}

/**
 * Check if a node has export modifier or is in a module scope
 * For simplicity, we extract all named declarations regardless of export status
 */
function getNodeName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return node.name.text;
  }
  if (ts.isClassDeclaration(node) && node.name) {
    return node.name.text;
  }
  if (ts.isInterfaceDeclaration(node)) {
    return node.name.text;
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return node.name.text;
  }
  if (ts.isEnumDeclaration(node)) {
    return node.name.text;
  }
  return null;
}

/**
 * Determine ScriptKind based on file extension
 */
function getScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".mts")) return ts.ScriptKind.TS;
  if (filePath.endsWith(".cts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.TS;
}

/**
 * Parse a TypeScript file and extract semantic entities
 * @param filePath - Absolute path to .ts, .tsx, .mts, or .cts file
 * @returns Array of parsed entities
 * @throws Error if file cannot be read or path is outside allowed directory
 */
export async function parseTypeScriptFile(
  filePath: string
): Promise<readonly ParsedEntity[]> {
  // Security: Validate path is within allowed base directory
  const basePath = getAllowedBasePath();
  await validatePathWithinBase(filePath, basePath);

  const sourceText = await readFile(filePath, "utf-8");

  // Handle empty files
  if (sourceText.trim().length === 0) {
    return [];
  }

  const scriptKind = getScriptKind(filePath);

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  // Check for syntax errors and warn if present
  // Use program-based diagnostics for syntax error detection
  const syntaxDiagnostics = ts
    .getPreEmitDiagnostics(
      ts.createProgram({
        rootNames: [filePath],
        options: { noEmit: true },
        host: {
          ...ts.createCompilerHost({ noEmit: true }),
          readFile: (fileName) =>
            fileName === filePath ? sourceText : ts.sys.readFile(fileName),
          fileExists: (fileName) =>
            fileName === filePath || ts.sys.fileExists(fileName),
        },
      })
    )
    .filter((d) => d.category === ts.DiagnosticCategory.Error);

  if (syntaxDiagnostics.length > 0) {
    console.warn(
      `[Parser] ${syntaxDiagnostics.length} syntax issue(s) in ${filePath}, results may be incomplete`
    );
  }

  const entities: ParsedEntity[] = [];

  function visit(node: ts.Node): void {
    const chunkType = getChunkType(node);

    if (chunkType !== null) {
      // Handle variable statements specially - they can have multiple declarations
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            entities.push(
              createEntity(
                node,
                chunkType,
                declaration.name.text,
                sourceFile,
                filePath
              )
            );
            // For variable statements, we only want one entity per statement
            // since the entire statement is the code block
            break;
          }
        }
      } else {
        const name = getNodeName(node);
        if (name !== null) {
          entities.push(
            createEntity(node, chunkType, name, sourceFile, filePath)
          );
        }
      }
    }

    // Continue traversing, but don't descend into class/function bodies
    // for top-level extraction (class methods are part of the class chunk)
    if (!ts.isClassDeclaration(node) && !ts.isFunctionDeclaration(node)) {
      ts.forEachChild(node, visit);
    }
  }

  ts.forEachChild(sourceFile, visit);

  return entities;
}

/**
 * Check if a path is a TypeScript file
 * Supports .ts, .tsx, .mts, .cts extensions
 */
function isTypeScriptFile(filePath: string): boolean {
  return /\.(ts|tsx|mts|cts)$/.test(filePath);
}

/**
 * Check if a directory should be skipped during traversal
 */
function shouldSkipDirectory(dirName: string): boolean {
  const skipDirs = new Set([
    "node_modules",
    "dist",
    ".git",
    "coverage",
    ".next",
    "build",
    "out",
    "__pycache__",
  ]);
  return skipDirs.has(dirName) || dirName.startsWith(".");
}

/**
 * Get all TypeScript files in a directory recursively
 * @param dirPath - Absolute path to directory
 * @returns Array of absolute file paths
 * @throws Error if path is outside allowed directory or max depth exceeded
 */
export async function findTypeScriptFiles(
  dirPath: string
): Promise<readonly string[]> {
  // Security: Validate path is within allowed base directory
  const basePath = getAllowedBasePath();
  await validatePathWithinBase(dirPath, basePath);

  const files: string[] = [];

  async function traverse(currentPath: string, depth: number): Promise<void> {
    // Security: Limit recursion depth to prevent resource exhaustion
    const maxDepth = getConfigValue("RAG_MAX_DIRECTORY_DEPTH");
    if (depth > maxDepth) {
      console.warn(
        `[Parser] Max directory depth (${maxDepth}) reached at ${currentPath}`
      );
      return;
    }

    const entries = await readdir(currentPath);

    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        if (!shouldSkipDirectory(entry)) {
          await traverse(fullPath, depth + 1);
        }
      } else if (stats.isFile() && isTypeScriptFile(entry)) {
        // Skip test files and declaration files
        if (
          !entry.includes(".test.") &&
          !entry.includes(".spec.") &&
          !entry.endsWith(".d.ts")
        ) {
          files.push(fullPath);
        }
      }
    }
  }

  await traverse(dirPath, 0);
  return files;
}
