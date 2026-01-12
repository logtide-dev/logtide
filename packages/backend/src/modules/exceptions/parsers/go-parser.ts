/**
 * Go Stack Trace Parser
 *
 * Parses Go panic/runtime error stack traces in the format:
 * panic: message
 *
 * goroutine 1 [running]:
 * main.functionName(args)
 *   /path/to/file.go:42 +0x123
 * main.anotherFunc()
 *   /path/to/other.go:10 +0x456
 */

import { BaseExceptionParser } from './base-parser.js';
import type { ExceptionLanguage, ParsedException, StackFrame } from '../types.js';

export class GoExceptionParser extends BaseExceptionParser {
  readonly language: ExceptionLanguage = 'go';

  private readonly PANIC_PATTERN = /^panic:\s*(.+?)$/m;

  private readonly RUNTIME_ERROR_PATTERN = /^runtime error:\s*(.+?)$/m;

  private readonly GOROUTINE_PATTERN = /^goroutine\s+\d+\s+\[.+\]:$/m;

  private readonly FUNCTION_PATTERN = /^([a-zA-Z0-9_/.]+(?:\.[a-zA-Z0-9_]+)*)\(.*\)$/;

  private readonly LOCATION_PATTERN = /^\s+(.+\.go):(\d+)\s+(?:\+0x[0-9a-f]+)?$/;

  canParse(message: string): boolean {
    if (!message) return false;
    const hasPanicOrError =
      this.PANIC_PATTERN.test(message) || this.RUNTIME_ERROR_PATTERN.test(message);
    const hasGoroutine = this.GOROUTINE_PATTERN.test(message);
    return hasPanicOrError && hasGoroutine;
  }

  parse(message: string): ParsedException | null {
    if (!this.canParse(message)) return null;

    let exceptionType = 'panic';
    let exceptionMessage = '';

    const panicMatch = message.match(this.PANIC_PATTERN);
    if (panicMatch) {
      exceptionMessage = panicMatch[1];
    }

    const runtimeMatch = message.match(this.RUNTIME_ERROR_PATTERN);
    if (runtimeMatch) {
      exceptionType = 'runtime error';
      exceptionMessage = runtimeMatch[1];
    }

    const lines = message.split('\n');
    const frames: StackFrame[] = [];
    let frameIndex = 0;
    let currentFunction: string | null = null;
    let inGoroutine = false;

    for (const line of lines) {
      if (this.GOROUTINE_PATTERN.test(line)) {
        inGoroutine = true;
        continue;
      }

      if (!inGoroutine) continue;

      const funcMatch = line.match(this.FUNCTION_PATTERN);
      if (funcMatch) {
        currentFunction = funcMatch[1];
        continue;
      }

      const locMatch = line.match(this.LOCATION_PATTERN);
      if (locMatch && currentFunction) {
        const [, filePath, lineNum] = locMatch;

        frames.push({
          frameIndex: frameIndex++,
          filePath: filePath.trim(),
          functionName: this.cleanFunctionName(currentFunction),
          lineNumber: parseInt(lineNum, 10),
          columnNumber: undefined,
          isAppCode: !this.isLibraryPath(filePath),
          metadata: {
            fullFunctionName: currentFunction,
          },
        });

        currentFunction = null;
      }

      if (line === '' && frames.length > 0) {
        break;
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

  protected cleanFunctionName(name: string): string {
    const parts = name.split('/');
    return parts[parts.length - 1];
  }

  protected isLibraryPath(filePath: string): boolean {
    const goLibPatterns = [
      /\$GOROOT/,
      /go\/pkg\/mod/,
      /vendor\//,
      /runtime\//,
      /src\/runtime/,
      /src\/internal/,
    ];

    return (
      super.isLibraryPath(filePath) ||
      goLibPatterns.some((pattern) => pattern.test(filePath))
    );
  }
}
