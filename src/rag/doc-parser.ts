import { readFile, readdir, stat } from "fs/promises";
import { join, basename } from "path";
import type { DocType } from "./types.js";
import { DocTypeSchema } from "./types.js";
import { getConfigValue } from "../utils.js";

// ===== Types =====

export interface DocSection {
  readonly heading: string;
  readonly level: number;
  readonly content: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface ParsedDocument {
  readonly title: string;
  readonly docType: DocType;
  readonly sections: readonly DocSection[];
  readonly filePath: string;
  readonly frontmatter: Readonly<Record<string, string>>;
}

// ===== Helper Functions =====

/**
 * Parse YAML frontmatter from document content
 * Supports simple key: value format
 */
function parseFrontmatter(content: string): {
  frontmatter: Readonly<Record<string, string>>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: content };

  const yamlStr = match[1] ?? "";
  const body = content.slice(match[0].length);

  const frontmatter: Record<string, string> = {};
  for (const line of yamlStr.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

/**
 * Extract sections from markdown content based on headings
 */
function extractSections(content: string): readonly DocSection[] {
  const lines = content.split("\n");
  const sections: DocSection[] = [];

  let currentHeading = "";
  let currentLevel = 0;
  let currentContent: string[] = [];
  let sectionStartLine = 1;

  const headingRegex = /^(#{1,6})\s+(.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = line.match(headingRegex);

    if (match) {
      // Save previous section if it has content
      if (currentHeading || currentContent.length > 0) {
        const trimmedContent = currentContent.join("\n").trim();
        if (trimmedContent) {
          sections.push({
            heading: currentHeading || "Introduction",
            level: currentLevel || 1,
            content: trimmedContent,
            startLine: sectionStartLine,
            endLine: i,
          });
        }
      }

      // Start new section
      currentHeading = match[2] ?? "";
      currentLevel = match[1]?.length ?? 1;
      currentContent = [];
      sectionStartLine = i + 1;
    } else {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentHeading || currentContent.length > 0) {
    const trimmedContent = currentContent.join("\n").trim();
    if (trimmedContent || currentHeading) {
      sections.push({
        heading: currentHeading || "Introduction",
        level: currentLevel || 1,
        content: trimmedContent,
        startLine: sectionStartLine,
        endLine: lines.length,
      });
    }
  }

  return sections;
}

/**
 * Detect document type from file path or frontmatter
 * Priority: 1. Frontmatter type → 2. Folder name → 3. Filename prefix → 4. Default notes
 */
export function detectDocumentType(
  filePath: string,
  frontmatter: Readonly<Record<string, string>>
): DocType {
  // 1. From frontmatter (highest priority)
  if (frontmatter["type"]) {
    const parsed = DocTypeSchema.safeParse(frontmatter["type"]);
    if (parsed.success) return parsed.data;
  }

  const pathLower = filePath.toLowerCase();

  // 2. From folder path
  if (pathLower.includes("/prd/") || pathLower.includes("/prds/")) return "prd";
  if (pathLower.includes("/adr/") || pathLower.includes("/adrs/")) return "adr";
  if (pathLower.includes("/api/") || pathLower.includes("/specs/")) return "api";

  // 3. From filename prefix
  const fileName = basename(filePath).toLowerCase();
  if (fileName.startsWith("prd-")) return "prd";
  if (fileName.startsWith("adr-")) return "adr";
  if (fileName.startsWith("api-") || fileName.startsWith("spec-")) return "api";
  if (
    fileName.startsWith("analysis-") ||
    fileName.startsWith("research-") ||
    fileName.startsWith("notes-")
  )
    return "notes";

  return "notes";
}

// ===== Public Functions =====

/**
 * Parse a markdown file into a structured document
 * @param filePath - Absolute path to the markdown file
 * @returns Parsed document with sections
 */
export async function parseMarkdownFile(
  filePath: string
): Promise<ParsedDocument> {
  const content = await readFile(filePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(content);
  const sections = extractSections(body);

  // Extract title from first H1 or filename
  const firstH1 = sections.find((s) => s.level === 1);
  const title = firstH1?.heading ?? basename(filePath, ".md");

  return {
    title,
    docType: detectDocumentType(filePath, frontmatter),
    sections,
    filePath,
    frontmatter,
  };
}

/**
 * Find all markdown files in a directory recursively
 * @param dirPath - Directory to search
 * @returns List of absolute file paths
 */
export async function findDocumentFiles(
  dirPath: string
): Promise<readonly string[]> {
  const files: string[] = [];
  const maxDepth = getConfigValue("RAG_MAX_DIRECTORY_DEPTH");

  async function traverse(currentPath: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      // Directory doesn't exist or not accessible
      return;
    }

    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.startsWith(".")) continue;

      const fullPath = join(currentPath, entry);

      let stats;
      try {
        stats = await stat(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        await traverse(fullPath, depth + 1);
      } else if (entry.endsWith(".md") && !entry.startsWith("_")) {
        files.push(fullPath);
      }
    }
  }

  await traverse(dirPath, 0);
  return files;
}
