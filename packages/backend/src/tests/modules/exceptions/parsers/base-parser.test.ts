import { describe, it, expect } from 'vitest';
import { BaseExceptionParser } from '../../../../modules/exceptions/parsers/base-parser.js';
import type { ExceptionLanguage, ParsedException, StackFrame } from '../../../../modules/exceptions/types.js';

// Create a concrete implementation for testing the base class
class TestParser extends BaseExceptionParser {
  readonly language: ExceptionLanguage = 'nodejs';

  canParse(message: string): boolean {
    return message?.includes('TestError') ?? false;
  }

  parse(message: string): ParsedException | null {
    if (!this.canParse(message)) return null;
    return {
      exceptionType: 'TestError',
      exceptionMessage: 'test',
      language: this.language,
      rawStackTrace: message,
      frames: [],
    };
  }

  // Expose protected methods for testing
  public testNormalizeFilePath(path: string): string {
    return this.normalizeFilePath(path);
  }

  public testIsLibraryPath(path: string): boolean {
    return this.isLibraryPath(path);
  }

  public testCleanFunctionName(name: string | undefined): string | undefined {
    return this.cleanFunctionName(name);
  }
}

describe('BaseExceptionParser', () => {
  const parser = new TestParser();

  describe('normalize', () => {
    it('should normalize stack frames for fingerprinting', () => {
      const frames: StackFrame[] = [
        {
          frameIndex: 0,
          filePath: '/app/src/handler.js',
          functionName: 'handleRequest',
          lineNumber: 42,
          isAppCode: true,
        },
        {
          frameIndex: 1,
          filePath: '/app/src/router.js',
          functionName: 'dispatch',
          lineNumber: 100,
          isAppCode: true,
        },
      ];

      const result = parser.normalize(frames);

      expect(result).toBe('src/handler.js:handleRequest|src/router.js:dispatch');
    });

    it('should filter out library code', () => {
      const frames: StackFrame[] = [
        {
          frameIndex: 0,
          filePath: '/app/node_modules/express/lib/router.js',
          functionName: 'Router.handle',
          lineNumber: 100,
          isAppCode: false,
        },
        {
          frameIndex: 1,
          filePath: '/app/src/handler.js',
          functionName: 'myHandler',
          lineNumber: 20,
          isAppCode: true,
        },
      ];

      const result = parser.normalize(frames);

      expect(result).toBe('src/handler.js:myHandler');
      expect(result).not.toContain('node_modules');
    });

    it('should limit to 10 frames', () => {
      const frames: StackFrame[] = Array.from({ length: 15 }, (_, i) => ({
        frameIndex: i,
        filePath: `/app/src/file${i}.js`,
        functionName: `func${i}`,
        lineNumber: i + 1,
        isAppCode: true,
      }));

      const result = parser.normalize(frames);

      expect(result.split('|').length).toBe(10);
    });

    it('should use <anonymous> for missing function names', () => {
      const frames: StackFrame[] = [
        {
          frameIndex: 0,
          filePath: '/app/src/script.js',
          functionName: undefined,
          lineNumber: 10,
          isAppCode: true,
        },
      ];

      const result = parser.normalize(frames);

      expect(result).toBe('src/script.js:<anonymous>');
    });

    it('should return empty string for no app code frames', () => {
      const frames: StackFrame[] = [
        {
          frameIndex: 0,
          filePath: '/node_modules/lib/index.js',
          functionName: 'libFunc',
          lineNumber: 10,
          isAppCode: false,
        },
      ];

      const result = parser.normalize(frames);

      expect(result).toBe('');
    });
  });

  describe('normalizeFilePath', () => {
    it('should remove /app/ prefix', () => {
      expect(parser.testNormalizeFilePath('/app/src/handler.js')).toBe('src/handler.js');
    });

    it('should remove /home/user/ prefix', () => {
      expect(parser.testNormalizeFilePath('/home/john/project/main.py')).toBe('project/main.py');
    });

    it('should remove /var/www/ prefix', () => {
      expect(parser.testNormalizeFilePath('/var/www/html/index.php')).toBe('html/index.php');
    });

    it('should remove Windows user path prefix', () => {
      expect(parser.testNormalizeFilePath('C:\\Users\\dev\\project\\main.js')).toBe('project/main.js');
    });

    it('should remove /Users/user/ prefix on Mac', () => {
      expect(parser.testNormalizeFilePath('/Users/developer/app/src/file.ts')).toBe('app/src/file.ts');
    });

    it('should convert backslashes to forward slashes', () => {
      expect(parser.testNormalizeFilePath('src\\module\\handler.js')).toBe('src/module/handler.js');
    });

    it('should handle path with no prefix', () => {
      expect(parser.testNormalizeFilePath('src/handler.js')).toBe('src/handler.js');
    });
  });

  describe('isLibraryPath', () => {
    it('should detect node_modules as library', () => {
      expect(parser.testIsLibraryPath('/app/node_modules/express/lib/router.js')).toBe(true);
    });

    it('should detect vendor as library', () => {
      expect(parser.testIsLibraryPath('/var/www/vendor/symfony/http/Request.php')).toBe(true);
    });

    it('should detect site-packages as library', () => {
      expect(parser.testIsLibraryPath('/usr/lib/python3.9/site-packages/django/core.py')).toBe(true);
    });

    it('should detect .cargo as library', () => {
      expect(parser.testIsLibraryPath('/home/user/.cargo/registry/src/crate/lib.rs')).toBe(true);
    });

    it('should detect go/pkg/mod as library', () => {
      expect(parser.testIsLibraryPath('/home/user/go/pkg/mod/github.com/lib/pq/conn.go')).toBe(true);
    });

    it('should detect .m2/repository as library', () => {
      expect(parser.testIsLibraryPath('/home/user/.m2/repository/org/apache/lib.jar')).toBe(true);
    });

    it('should detect <internal> as library', () => {
      expect(parser.testIsLibraryPath('<internal>/modules/cjs/loader.js')).toBe(true);
    });

    it('should detect <frozen as library', () => {
      expect(parser.testIsLibraryPath('<frozen importlib._bootstrap>')).toBe(true);
    });

    it('should detect lib/python as library', () => {
      expect(parser.testIsLibraryPath('/usr/lib/python3.9/asyncio/base_events.py')).toBe(true);
    });

    it('should detect $GOROOT as library', () => {
      expect(parser.testIsLibraryPath('$GOROOT/src/runtime/panic.go')).toBe(true);
    });

    it('should detect phar: as library', () => {
      expect(parser.testIsLibraryPath('phar:///usr/bin/composer/src/Composer.php')).toBe(true);
    });

    it('should not detect app code as library', () => {
      expect(parser.testIsLibraryPath('/app/src/handler.js')).toBe(false);
      expect(parser.testIsLibraryPath('/var/www/html/myapp/controller.php')).toBe(false);
    });
  });

  describe('cleanFunctionName', () => {
    it('should trim whitespace', () => {
      expect(parser.testCleanFunctionName('  handleRequest  ')).toBe('handleRequest');
    });

    it('should collapse multiple spaces', () => {
      expect(parser.testCleanFunctionName('async   function   handler')).toBe('async function handler');
    });

    it('should return undefined for undefined input', () => {
      expect(parser.testCleanFunctionName(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      // Empty string is falsy, so returns undefined
      expect(parser.testCleanFunctionName('')).toBeUndefined();
    });

    it('should preserve valid function name', () => {
      expect(parser.testCleanFunctionName('myFunction')).toBe('myFunction');
    });

    it('should handle function with class', () => {
      expect(parser.testCleanFunctionName('MyClass.myMethod')).toBe('MyClass.myMethod');
    });
  });
});
