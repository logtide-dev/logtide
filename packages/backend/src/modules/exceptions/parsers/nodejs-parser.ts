/**
 * Node.js Stack Trace Parser
 *
 * Parses V8 JavaScript stack traces in the format:
 * Error: message
 *   at functionName (file.js:line:column)
 *   at file.js:line:column
 */

import { BaseExceptionParser } from './base-parser.js';
import type { ExceptionLanguage, ParsedException, StackFrame } from '../types.js';

export class NodeJSExceptionParser extends BaseExceptionParser {
  readonly language: ExceptionLanguage = 'nodejs';

  private readonly EXCEPTION_PATTERN = /^([A-Z][a-zA-Z]*(?:Error|Exception)):\s*(.+?)$/m;

  private readonly STACK_FRAME_WITH_PARENS =
    /^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/;

  private readonly STACK_FRAME_WITHOUT_PARENS = /^\s*at\s+(.+?):(\d+):(\d+)$/;

  private readonly ANONYMOUS_FRAME = /^\s*at\s+<anonymous>$/;

  canParse(message: string): boolean {
    if (!message) return false;
    const hasException = this.EXCEPTION_PATTERN.test(message);
    const hasStackFrame = /^\s*at\s+/m.test(message);
    return hasException && hasStackFrame;
  }

  parse(message: string): ParsedException | null {
    if (!this.canParse(message)) return null;

    const exceptionMatch = message.match(this.EXCEPTION_PATTERN);
    if (!exceptionMatch) return null;

    const [, exceptionType, exceptionMessage] = exceptionMatch;
    const lines = message.split('\n');
    const frames: StackFrame[] = [];

    let frameIndex = 0;
    for (const line of lines) {
      const frame = this.parseFrame(line, frameIndex);
      if (frame) {
        frames.push(frame);
        frameIndex++;
      }
    }

    if (frames.length === 0) return null;

    return {
      exceptionType,
      exceptionMessage,
      language: this.language,
      rawStackTrace: message,
      frames,
    };
  }

  private parseFrame(line: string, frameIndex: number): StackFrame | null {
    let match = line.match(this.STACK_FRAME_WITH_PARENS);
    if (match) {
      const [, functionName, filePath, lineNum, colNum] = match;
      return {
        frameIndex,
        filePath: filePath.trim(),
        functionName: this.cleanFunctionName(functionName),
        lineNumber: parseInt(lineNum, 10),
        columnNumber: parseInt(colNum, 10),
        isAppCode: !this.isLibraryPath(filePath),
      };
    }

    match = line.match(this.STACK_FRAME_WITHOUT_PARENS);
    if (match) {
      const [, filePath, lineNum, colNum] = match;
      return {
        frameIndex,
        filePath: filePath.trim(),
        functionName: undefined,
        lineNumber: parseInt(lineNum, 10),
        columnNumber: parseInt(colNum, 10),
        isAppCode: !this.isLibraryPath(filePath),
      };
    }

    if (this.ANONYMOUS_FRAME.test(line)) {
      return {
        frameIndex,
        filePath: '<anonymous>',
        functionName: '<anonymous>',
        lineNumber: undefined,
        columnNumber: undefined,
        isAppCode: true,
      };
    }

    return null;
  }
}
