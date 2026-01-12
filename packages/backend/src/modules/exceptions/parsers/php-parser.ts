/**
 * PHP Stack Trace Parser
 *
 * Parses PHP exception stack traces in the format:
 * Fatal error: Uncaught Exception: message in /path/file.php:42
 * Stack trace:
 * #0 /path/file.php(42): ClassName->methodName()
 * #1 /path/other.php(10): AnotherClass::staticMethod()
 * #2 {main}
 */

import { BaseExceptionParser } from './base-parser.js';
import type { ExceptionLanguage, ParsedException, StackFrame } from '../types.js';

export class PHPExceptionParser extends BaseExceptionParser {
  readonly language: ExceptionLanguage = 'php';

  private readonly EXCEPTION_HEADER_PATTERN =
    /^(?:Fatal error:|Uncaught )?([A-Z][a-zA-Z_\\]+(?:Exception|Error)):\s*(.+?)(?:\s+in\s+.+)?$/m;

  private readonly STACK_FRAME_PATTERN =
    /^#(\d+)\s+(.+?)\((\d+)\):\s+(.+?)(?:\(.*\))?$/;

  private readonly MAIN_FRAME = /^#\d+\s+\{main\}$/;

  private readonly STACK_TRACE_START = /^Stack trace:$/m;

  canParse(message: string): boolean {
    if (!message) return false;
    return (
      this.EXCEPTION_HEADER_PATTERN.test(message) &&
      this.STACK_TRACE_START.test(message)
    );
  }

  parse(message: string): ParsedException | null {
    if (!this.canParse(message)) return null;

    const exceptionMatch = message.match(this.EXCEPTION_HEADER_PATTERN);
    if (!exceptionMatch) return null;

    const exceptionType = this.getSimpleClassName(exceptionMatch[1]);
    const exceptionMessage = exceptionMatch[2];

    const lines = message.split('\n');
    const frames: StackFrame[] = [];
    let inStackTrace = false;

    for (const line of lines) {
      if (this.STACK_TRACE_START.test(line)) {
        inStackTrace = true;
        continue;
      }

      if (!inStackTrace) continue;

      if (this.MAIN_FRAME.test(line)) {
        break;
      }

      const frameMatch = line.match(this.STACK_FRAME_PATTERN);
      if (frameMatch) {
        const [, frameNum, filePath, lineNum, functionCall] = frameMatch;
        const { className, methodName } = this.parseFunctionCall(functionCall);

        frames.push({
          frameIndex: parseInt(frameNum, 10),
          filePath: filePath.trim(),
          functionName: className ? `${className}::${methodName}` : methodName,
          lineNumber: parseInt(lineNum, 10),
          columnNumber: undefined,
          isAppCode: !this.isLibraryPath(filePath),
          metadata: {
            className,
            methodName,
          },
        });
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

  private getSimpleClassName(fullClassName: string): string {
    const parts = fullClassName.split('\\');
    return parts[parts.length - 1];
  }

  private parseFunctionCall(call: string): { className?: string; methodName: string } {
    const instanceMatch = call.match(/^(.+)->(.+)$/);
    if (instanceMatch) {
      return {
        className: instanceMatch[1],
        methodName: instanceMatch[2],
      };
    }

    const staticMatch = call.match(/^(.+)::(.+)$/);
    if (staticMatch) {
      return {
        className: staticMatch[1],
        methodName: staticMatch[2],
      };
    }

    return { methodName: call };
  }

  protected isLibraryPath(filePath: string): boolean {
    const phpLibPatterns = [
      /vendor\//,
      /phar:/,
      /\/usr\/share\/php/,
      /\/Symfony\//,
      /\/Laravel\//,
      /\/Composer\//,
      /\/doctrine\//,
      /\/guzzle\//,
    ];

    return (
      super.isLibraryPath(filePath) ||
      phpLibPatterns.some((pattern) => pattern.test(filePath))
    );
  }
}
