/**
 * Python Stack Trace Parser
 *
 * Parses Python traceback in the format:
 * Traceback (most recent call last):
 *   File "file.py", line 10, in function_name
 *     code_line
 * ExceptionType: message
 */

import { BaseExceptionParser } from './base-parser.js';
import type { ExceptionLanguage, ParsedException, StackFrame } from '../types.js';

export class PythonExceptionParser extends BaseExceptionParser {
  readonly language: ExceptionLanguage = 'python';

  private readonly TRACEBACK_START = /Traceback \(most recent call last\):/;

  private readonly FRAME_PATTERN =
    /^\s*File "(.+?)", line (\d+)(?:, in (.+))?$/;

  private readonly EXCEPTION_PATTERN = /^([A-Z][a-zA-Z]*(?:Error|Exception|Warning)):\s*(.+?)$/m;

  private readonly CHAINED_EXCEPTION =
    /^(?:During handling of the above exception|The above exception was the direct cause)/;

  canParse(message: string): boolean {
    if (!message) return false;
    return (
      this.TRACEBACK_START.test(message) &&
      (this.EXCEPTION_PATTERN.test(message) || this.FRAME_PATTERN.test(message))
    );
  }

  parse(message: string): ParsedException | null {
    if (!this.canParse(message)) return null;

    const lines = message.split('\n');
    const frames: StackFrame[] = [];
    let exceptionType = 'UnknownError';
    let exceptionMessage = '';
    let frameIndex = 0;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      const frameMatch = line.match(this.FRAME_PATTERN);
      if (frameMatch) {
        const [, filePath, lineNum, functionName] = frameMatch;
        let codeLine: string | undefined;

        if (i + 1 < lines.length && lines[i + 1].startsWith('    ')) {
          codeLine = lines[i + 1].trim();
          i++;
        }

        frames.push({
          frameIndex: frameIndex++,
          filePath: filePath.trim(),
          functionName: this.cleanFunctionName(functionName),
          lineNumber: parseInt(lineNum, 10),
          columnNumber: undefined,
          isAppCode: !this.isLibraryPath(filePath),
          codeContext: codeLine ? { line: codeLine } : undefined,
        });
      }

      const exceptionMatch = line.match(this.EXCEPTION_PATTERN);
      if (exceptionMatch) {
        exceptionType = exceptionMatch[1];
        exceptionMessage = exceptionMatch[2];
      }

      if (this.CHAINED_EXCEPTION.test(line)) {
        break;
      }

      i++;
    }

    if (frames.length === 0) return null;

    frames.reverse();

    return {
      exceptionType,
      exceptionMessage,
      language: this.language,
      rawStackTrace: message,
      frames,
    };
  }

  protected isLibraryPath(filePath: string): boolean {
    const pythonLibPatterns = [
      /site-packages/,
      /lib\/python\d/,
      /<frozen/,
      /importlib\._bootstrap/,
      /\/usr\/lib\/python/,
      /venv\//,
      /\.venv\//,
      /virtualenv/,
    ];

    return (
      super.isLibraryPath(filePath) ||
      pythonLibPatterns.some((pattern) => pattern.test(filePath))
    );
  }
}
