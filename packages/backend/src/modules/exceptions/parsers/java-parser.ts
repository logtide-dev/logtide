/**
 * Java Stack Trace Parser
 *
 * Parses Java exception stack traces in the format:
 * java.lang.NullPointerException: message
 *   at com.example.Class.method(File.java:42)
 *   at com.example.Other.method(Other.java:10)
 * Caused by: java.io.IOException: nested message
 *   at ...
 */

import { BaseExceptionParser } from './base-parser.js';
import type { ExceptionLanguage, ParsedException, StackFrame } from '../types.js';

export class JavaExceptionParser extends BaseExceptionParser {
  readonly language: ExceptionLanguage = 'java';

  private readonly EXCEPTION_PATTERN =
    /^((?:java|javax|org|com|io|net)\.[A-Za-z0-9_.]+(?:Exception|Error|Throwable))(?::\s*(.+))?$/m;

  private readonly STACK_FRAME_PATTERN =
    /^\s*at\s+([a-zA-Z0-9$_.]+)\.([a-zA-Z0-9$_<>]+)\((.+?)(?::(\d+))?\)$/;

  private readonly CAUSED_BY = /^Caused by:\s*/;

  private readonly SUPPRESSED = /^\s*Suppressed:\s*/;

  private readonly MORE_FRAMES = /^\s*\.\.\.\s*(\d+)\s+more$/;

  canParse(message: string): boolean {
    if (!message) return false;
    return (
      this.EXCEPTION_PATTERN.test(message) &&
      /^\s*at\s+/m.test(message)
    );
  }

  parse(message: string): ParsedException | null {
    if (!this.canParse(message)) return null;

    const lines = message.split('\n');
    const frames: StackFrame[] = [];
    let exceptionType = 'UnknownException';
    let exceptionMessage = '';
    let frameIndex = 0;

    for (const line of lines) {
      if (this.CAUSED_BY.test(line) || this.SUPPRESSED.test(line)) {
        break;
      }

      const exceptionMatch = line.match(this.EXCEPTION_PATTERN);
      if (exceptionMatch) {
        exceptionType = this.getSimpleClassName(exceptionMatch[1]);
        exceptionMessage = exceptionMatch[2] || '';
        continue;
      }

      if (this.MORE_FRAMES.test(line)) {
        continue;
      }

      const frameMatch = line.match(this.STACK_FRAME_PATTERN);
      if (frameMatch) {
        const [, className, methodName, fileInfo, lineNum] = frameMatch;
        const filePath = this.buildFilePath(className, fileInfo);

        frames.push({
          frameIndex: frameIndex++,
          filePath,
          functionName: `${this.getSimpleClassName(className)}.${methodName}`,
          lineNumber: lineNum ? parseInt(lineNum, 10) : undefined,
          columnNumber: undefined,
          isAppCode: !this.isLibraryPath(className),
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
    const parts = fullClassName.split('.');
    return parts[parts.length - 1];
  }

  private buildFilePath(className: string, fileInfo: string): string {
    if (fileInfo === 'Native Method') {
      return `${className} (Native Method)`;
    }
    if (fileInfo === 'Unknown Source') {
      return `${className} (Unknown Source)`;
    }
    const packagePath = className.replace(/\.[^.]+$/, '').replace(/\./g, '/');
    return `${packagePath}/${fileInfo}`;
  }

  protected isLibraryPath(classPath: string): boolean {
    const javaLibPatterns = [
      /^java\./,
      /^javax\./,
      /^sun\./,
      /^com\.sun\./,
      /^org\.springframework\./,
      /^org\.apache\./,
      /^org\.hibernate\./,
      /^com\.fasterxml\./,
      /^io\.netty\./,
      /^reactor\./,
    ];

    return javaLibPatterns.some((pattern) => pattern.test(classPath));
  }
}
