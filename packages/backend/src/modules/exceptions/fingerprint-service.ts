/**
 * Fingerprint Service
 *
 * Generates SHA-256 fingerprints for error grouping.
 * Fingerprints are based on:
 * - Exception type
 * - Normalized stack trace (app-code frames only, file paths + function names)
 */

import crypto from 'crypto';
import type { ParsedException, StackFrame } from './types.js';
import { ParserFactory } from './parsers/parser-factory.js';

export class FingerprintService {
  /**
   * Generate SHA-256 fingerprint from parsed exception
   * Groups exceptions with same root cause together
   */
  static generate(parsedException: ParsedException): string {
    const parser = ParserFactory.getParser(parsedException.language);
    const normalizedStack = parser
      ? parser.normalize(parsedException.frames)
      : this.defaultNormalize(parsedException.frames);

    const input = `${parsedException.exceptionType}:${normalizedStack}`;
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  /**
   * Generate fingerprint directly from stack frames
   */
  static generateFromFrames(
    exceptionType: string,
    frames: StackFrame[],
    language: string
  ): string {
    const parser = ParserFactory.getParser(language as any);
    const normalizedStack = parser
      ? parser.normalize(frames)
      : this.defaultNormalize(frames);

    const input = `${exceptionType}:${normalizedStack}`;
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  /**
   * Default normalization when parser is not available
   */
  private static defaultNormalize(frames: StackFrame[]): string {
    return frames
      .filter((f) => f.isAppCode)
      .slice(0, 10)
      .map((f) => `${this.normalizeFilePath(f.filePath)}:${f.functionName || '<anonymous>'}`)
      .join('|');
  }

  /**
   * Normalize file path by removing common prefixes
   */
  private static normalizeFilePath(filePath: string): string {
    return filePath
      .replace(/^\/app\//, '')
      .replace(/^\/home\/[^/]+\//, '')
      .replace(/^\/var\/www\//, '')
      .replace(/^C:\\[^\\]+\\/, '')
      .replace(/^\/Users\/[^/]+\//, '')
      .replace(/\\/g, '/');
  }

  /**
   * Normalize exception message by removing dynamic values
   * Useful for secondary grouping or display
   */
  static normalizeMessage(message: string): string {
    return message
      .replace(/\d+/g, 'N')
      .replace(/0x[0-9a-f]+/gi, '0xHEX')
      .replace(/'[^']*'/g, "'STRING'")
      .replace(/"[^"]*"/g, '"STRING"')
      .replace(/\[[^\]]*\]/g, '[ARRAY]')
      .replace(/\{[^}]*\}/g, '{OBJECT}')
      .trim();
  }
}
