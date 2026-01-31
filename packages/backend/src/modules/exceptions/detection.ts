/**
 * Exception Detection Service
 *
 * Detects and extracts exception data from logs using two methods:
 * 1. Structured metadata.exception (preferred)
 * 2. Text-based parsing from message (fallback)
 */

import { ParserFactory } from './parsers/parser-factory.js';
import type { ParsedException, StackFrame } from './types.js';
import type { ExceptionLanguage, StructuredException } from '@logtide/shared';

// Library patterns for detecting vendor/library code
const LIBRARY_PATTERNS = [
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
  /System\//,
  /Library\//,
];

/**
 * Maximum depth for cause chain to prevent DoS
 */
const MAX_CAUSE_DEPTH = 10;

/**
 * Maximum stack frames to process
 */
const MAX_STACK_FRAMES = 100;

export class ExceptionDetectionService {
  /**
   * Main entry point: detect exception from log
   * Priority:
   * 1. metadata.exception (structured)
   * 2. message text parsing (legacy/fallback)
   */
  static detectException(
    message: string,
    metadata?: Record<string, unknown>
  ): ParsedException | null {
    // Try structured exception first
    if (metadata?.exception) {
      const structured = this.parseStructuredException(metadata.exception);
      if (structured) {
        return structured;
      }
    }

    // Fallback to text parsing
    return ParserFactory.parse(message);
  }

  /**
   * Convert structured exception to internal ParsedException format
   */
  private static parseStructuredException(
    exception: unknown,
    depth = 0
  ): ParsedException | null {
    // Guard against deep cause chains
    if (depth >= MAX_CAUSE_DEPTH) {
      return null;
    }

    if (!this.isValidStructuredException(exception)) {
      return null;
    }

    const frames = this.convertStackFrames(exception.stacktrace || []);

    // If no structured frames but raw trace exists, try parsing it
    if (frames.length === 0 && exception.raw) {
      return ParserFactory.parse(exception.raw);
    }

    return {
      exceptionType: exception.type,
      exceptionMessage: exception.message,
      language: (exception.language as ExceptionLanguage) || 'unknown',
      rawStackTrace: exception.raw || this.reconstructRawTrace(exception),
      frames,
    };
  }

  /**
   * Validate that metadata.exception has required fields
   */
  private static isValidStructuredException(
    obj: unknown
  ): obj is StructuredException {
    if (!obj || typeof obj !== 'object') return false;
    const ex = obj as Record<string, unknown>;
    return (
      typeof ex.type === 'string' &&
      typeof ex.message === 'string' &&
      ex.type.length > 0 &&
      ex.message.length > 0
    );
  }

  /**
   * Convert structured stack frames to internal format
   */
  private static convertStackFrames(
    structuredFrames: StructuredException['stacktrace']
  ): StackFrame[] {
    if (!structuredFrames || !Array.isArray(structuredFrames)) {
      return [];
    }

    const frames: StackFrame[] = [];

    for (let index = 0; index < Math.min(structuredFrames.length, MAX_STACK_FRAMES); index++) {
      const frame = structuredFrames[index];
      if (!frame || typeof frame !== 'object') {
        continue;
      }

      // Skip frames with no useful info
      if (!frame.file && !frame.function) {
        continue;
      }

      frames.push({
        frameIndex: index,
        filePath: frame.file || '<unknown>',
        functionName: frame.function,
        lineNumber: frame.line,
        columnNumber: frame.column,
        isAppCode: this.isAppCode(frame.file || ''),
        metadata: frame.metadata,
      });
    }

    return frames;
  }

  /**
   * Detect if a file path is application code vs library code
   */
  private static isAppCode(filePath: string): boolean {
    return !LIBRARY_PATTERNS.some((pattern) => pattern.test(filePath));
  }

  /**
   * Reconstruct a raw stack trace string from structured data
   * Used when raw is not provided
   */
  private static reconstructRawTrace(exception: StructuredException): string {
    const lines: string[] = [`${exception.type}: ${exception.message}`];

    if (exception.stacktrace) {
      for (const frame of exception.stacktrace) {
        const func = frame.function || '<anonymous>';
        const file = frame.file || '<unknown>';
        const location =
          frame.line !== undefined
            ? frame.column !== undefined
              ? `:${frame.line}:${frame.column}`
              : `:${frame.line}`
            : '';

        lines.push(`  at ${func} (${file}${location})`);
      }
    }

    if (exception.cause) {
      lines.push('');
      lines.push('Caused by:');
      lines.push(this.reconstructRawTrace(exception.cause));
    }

    return lines.join('\n');
  }
}
