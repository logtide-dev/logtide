import { describe, it, expect } from 'vitest';
import { NodeJSExceptionParser } from '../../../../modules/exceptions/parsers/nodejs-parser.js';

describe('NodeJSExceptionParser', () => {
  const parser = new NodeJSExceptionParser();

  describe('canParse', () => {
    it('should return true for valid Node.js error with stack trace', () => {
      const message = `Error: Something went wrong
    at Object.<anonymous> (/app/index.js:10:15)
    at Module._compile (internal/modules/cjs/loader.js:999:30)`;
      expect(parser.canParse(message)).toBe(true);
    });

    it('should return true for TypeError', () => {
      const message = `TypeError: Cannot read property 'foo' of undefined
    at processData (/app/processor.js:25:10)`;
      expect(parser.canParse(message)).toBe(true);
    });

    it('should return true for custom error types', () => {
      const message = `ValidationError: Invalid email format
    at validateInput (/app/validator.js:15:5)`;
      expect(parser.canParse(message)).toBe(true);
    });

    it('should return false for empty message', () => {
      expect(parser.canParse('')).toBe(false);
    });

    it('should return false for null/undefined message', () => {
      expect(parser.canParse(null as any)).toBe(false);
      expect(parser.canParse(undefined as any)).toBe(false);
    });

    it('should return false for non-Node.js stack trace', () => {
      const phpMessage = `Fatal error: Uncaught Exception: Error in /app/src/Service.php:42
Stack trace:
#0 /app/src/Controller.php(10): Service->process()`;
      expect(parser.canParse(phpMessage)).toBe(false);
    });

    it('should return false for error without stack trace', () => {
      const message = `Error: Something went wrong`;
      expect(parser.canParse(message)).toBe(false);
    });
  });

  describe('parse', () => {
    it('should parse basic Error', () => {
      const message = `Error: Database connection failed
    at Database.connect (/app/src/database.js:42:15)
    at Repository.init (/app/src/repository.js:10:20)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('Error');
      expect(result!.exceptionMessage).toBe('Database connection failed');
      expect(result!.language).toBe('nodejs');
      expect(result!.frames).toHaveLength(2);
      expect(result!.frames[0].filePath).toBe('/app/src/database.js');
      expect(result!.frames[0].lineNumber).toBe(42);
      expect(result!.frames[0].columnNumber).toBe(15);
      expect(result!.frames[0].functionName).toBe('Database.connect');
    });

    it('should parse TypeError with property access', () => {
      const message = `TypeError: Cannot read properties of undefined (reading 'map')
    at processArray (/app/processor.js:25:10)
    at Array.forEach (<anonymous>)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('TypeError');
      expect(result!.exceptionMessage).toContain('Cannot read properties of undefined');
    });

    it('should parse frames without function name', () => {
      const message = `Error: Something failed
    at /app/src/index.js:10:5`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].functionName).toBeUndefined();
      expect(result!.frames[0].filePath).toBe('/app/src/index.js');
    });

    it('should parse anonymous frames', () => {
      const message = `Error: Async error
    at <anonymous>`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].filePath).toBe('<anonymous>');
      expect(result!.frames[0].functionName).toBe('<anonymous>');
      expect(result!.frames[0].isAppCode).toBe(true);
    });

    it('should detect node_modules as library paths', () => {
      const message = `Error: Test error
    at Router.handle (/app/node_modules/express/lib/router/index.js:100:10)
    at myHandler (/app/src/handler.js:20:15)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].isAppCode).toBe(false); // node_modules
      expect(result!.frames[1].isAppCode).toBe(true); // app code
    });

    it('should detect internal modules as library paths', () => {
      const message = `Error: Test error
    at Module._compile (internal/modules/cjs/loader.js:999:30)
    at myFunction (/app/index.js:5:10)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].isAppCode).toBe(false); // internal
    });

    it('should clean async function names', () => {
      const message = `Error: Async operation failed
    at async UserService.createUser (/app/src/user-service.js:50:10)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].functionName).toBe('UserService.createUser');
    });

    it('should return null for unparseable message', () => {
      const result = parser.parse('random text without stack trace');
      expect(result).toBeNull();
    });

    it('should return null when no frames are parsed', () => {
      const message = `Error: Something went wrong
but no stack frames here`;

      const result = parser.parse(message);
      expect(result).toBeNull();
    });

    it('should preserve raw stack trace', () => {
      const message = `Error: Test
    at test (/app/test.js:1:1)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.rawStackTrace).toBe(message);
    });

    it('should handle ReferenceError', () => {
      const message = `ReferenceError: undefinedVariable is not defined
    at eval (/app/script.js:10:5)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('ReferenceError');
    });

    it('should handle SyntaxError', () => {
      const message = `SyntaxError: Unexpected token '}'
    at wrapSafe (internal/modules/cjs/loader.js:915:16)
    at Module._compile (internal/modules/cjs/loader.js:963:27)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('SyntaxError');
    });

    it('should handle custom ApplicationException', () => {
      const message = `ApplicationException: User not authorized
    at AuthMiddleware.check (/app/src/middleware/auth.js:30:10)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('ApplicationException');
    });

    it('should parse Windows paths', () => {
      const message = `Error: File not found
    at readFile (C:\\Users\\dev\\project\\src\\reader.js:15:10)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].filePath).toBe('C:\\Users\\dev\\project\\src\\reader.js');
    });
  });
});
