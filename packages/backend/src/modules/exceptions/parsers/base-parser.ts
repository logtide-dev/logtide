/**
 * Base Exception Parser
 *
 * Abstract class for language-specific stack trace parsers.
 * Each parser must implement language detection and stack trace parsing.
 */

import type { ExceptionLanguage, ParsedException, StackFrame } from '../types.js';

export abstract class BaseExceptionParser {
  abstract readonly language: ExceptionLanguage;

  /**
   * Detect if log message contains a stack trace for this language
   */
  abstract canParse(message: string): boolean;

  /**
   * Parse exception from log message
   * Returns null if parsing fails or message doesn't contain a valid stack trace
   */
  abstract parse(message: string): ParsedException | null;

  /**
   * Normalize stack trace for fingerprinting
   * Removes dynamic values (line numbers, memory addresses, etc.)
   * Returns a stable string that's the same for identical exception types
   */
  normalize(frames: StackFrame[]): string {
    return frames
      .filter((f) => f.isAppCode)
      .slice(0, 10)
      .map((f) => `${this.normalizeFilePath(f.filePath)}:${f.functionName || '<anonymous>'}`)
      .join('|');
  }

  /**
   * Normalize file path by removing common prefixes and making paths relative
   */
  protected normalizeFilePath(filePath: string): string {
    return filePath
      .replace(/^\/app\//, '')
      .replace(/^\/home\/[^/]+\//, '')
      .replace(/^\/var\/www\//, '')
      .replace(/^C:\\[^\\]+\\/, '')
      .replace(/^\/Users\/[^/]+\//, '')
      .replace(/\\/g, '/');
  }

  /**
   * Detect if a file path is likely library/vendor code
   */
  protected isLibraryPath(filePath: string): boolean {
    const libraryPatterns = [
      /node_modules/,
      /vendor\//,
      /site-packages/,
      /\.cargo/,
      /go\/pkg\/mod/,
      /\.m2\/repository/,
      /<internal>/,
      /<frozen/,
      /lib\/python\d/,
      /\$GOROOT/,
      /phar:/,
    ];
    return libraryPatterns.some((pattern) => pattern.test(filePath));
  }

  /**
   * Extract function name from various formats
   */
  protected cleanFunctionName(name: string | undefined): string | undefined {
    if (!name) return undefined;
    return name.trim().replace(/\s+/g, ' ');
  }
}
