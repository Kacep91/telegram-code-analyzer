/**
 * Path validation utilities for security
 * Prevents path traversal attacks by ensuring paths stay within allowed directories
 */
import { resolve, normalize, sep, dirname } from "path";
import { stat, realpath, lstat } from "fs/promises";

/**
 * Check if a normalized path is within a base directory
 * @param normalizedTarget - Normalized target path
 * @param normalizedBase - Normalized base path
 * @returns True if target is within base
 */
function isPathWithinBase(
  normalizedTarget: string,
  normalizedBase: string
): boolean {
  return (
    normalizedTarget === normalizedBase ||
    normalizedTarget.startsWith(normalizedBase + sep)
  );
}

/**
 * Validate that a path is within an allowed base directory
 * Prevents path traversal attacks (e.g., ../../../etc/passwd)
 * Uses lstat to detect symlinks and validates real paths after resolution
 *
 * @param targetPath - The path to validate
 * @param allowedBase - The base directory that must contain the target
 * @returns The resolved real path if valid
 * @throws Error if path is outside allowed directory or contains suspicious symlinks
 */
export async function validatePathWithinBase(
  targetPath: string,
  allowedBase: string
): Promise<string> {
  // Resolve to absolute paths
  const resolvedTarget = resolve(targetPath);
  const resolvedBase = resolve(allowedBase);

  // Get real path of base (must exist)
  const realBase = await realpath(resolvedBase);
  const normalizedBase = normalize(realBase);

  // Check if target exists
  let targetExists = false;
  try {
    await lstat(resolvedTarget);
    targetExists = true;
  } catch {
    targetExists = false;
  }

  if (targetExists) {
    // Target exists - get real path (resolves symlinks) and validate
    const realTarget = await realpath(resolvedTarget);
    const normalizedTarget = normalize(realTarget);

    if (!isPathWithinBase(normalizedTarget, normalizedBase)) {
      throw new Error(
        `Path "${targetPath}" resolves outside allowed directory`
      );
    }

    return realTarget;
  }

  // Target doesn't exist - validate parent directory exists and is within base
  // This prevents TOCTOU: we validate the parent which must already exist
  const parentPath = dirname(resolvedTarget);
  let realParent: string;
  try {
    realParent = await realpath(parentPath);
  } catch {
    throw new Error(`Parent directory does not exist: ${parentPath}`);
  }

  const normalizedParent = normalize(realParent);
  if (!isPathWithinBase(normalizedParent, normalizedBase)) {
    throw new Error(
      `Path "${targetPath}" parent directory is outside allowed directory`
    );
  }

  // Return the resolved path (parent is validated, target name is just appended)
  // The caller must re-validate after creating the file/directory
  return resolvedTarget;
}

/**
 * Get allowed base directory from environment
 * Requires PROJECT_PATH or ALLOWED_PROJECT_BASE to be set
 *
 * @returns The allowed base path
 * @throws Error if no base path is configured
 */
export function getAllowedBasePath(): string {
  const base =
    process.env["PROJECT_PATH"] || process.env["ALLOWED_PROJECT_BASE"];

  if (!base) {
    throw new Error("PROJECT_PATH or ALLOWED_PROJECT_BASE must be set");
  }

  return base;
}

/**
 * Validate that a project path exists, is a directory, and is within allowed base
 * Combined validation for CLI tools with TOCTOU protection
 *
 * @param projectPath - The project path to validate
 * @returns The validated real path
 * @throws Error if validation fails
 */
export async function validateProjectPath(
  projectPath: string
): Promise<string> {
  const basePath = getAllowedBasePath();

  // Initial validation
  const validatedPath = await validatePathWithinBase(projectPath, basePath);

  // Check if it's a directory
  const stats = await stat(validatedPath);
  if (!stats.isDirectory()) {
    throw new Error(`Project path is not a directory: ${projectPath}`);
  }

  // TOCTOU protection: re-validate real path after stat()
  // This catches cases where a symlink was created between validation and stat
  const finalRealPath = await realpath(validatedPath);
  const normalizedFinal = normalize(finalRealPath);
  const normalizedBase = normalize(await realpath(basePath));

  if (!isPathWithinBase(normalizedFinal, normalizedBase)) {
    throw new Error(
      `Path "${projectPath}" changed during validation - possible symlink attack`
    );
  }

  return finalRealPath;
}
