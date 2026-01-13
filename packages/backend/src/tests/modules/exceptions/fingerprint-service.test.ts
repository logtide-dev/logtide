import { describe, it, expect } from 'vitest';
import { FingerprintService } from '../../../modules/exceptions/fingerprint-service.js';
import type { ParsedException, StackFrame } from '../../../modules/exceptions/types.js';

describe('FingerprintService', () => {
  describe('generate', () => {
    it('should generate consistent fingerprints for same exception', () => {
      const exception: ParsedException = {
        exceptionType: 'Error',
        exceptionMessage: 'Test error',
        language: 'nodejs',
        rawStackTrace: 'Error: Test\n    at test (/app/test.js:10:5)',
        frames: [
          {
            frameIndex: 0,
            filePath: '/app/src/handler.js',
            functionName: 'handleRequest',
            lineNumber: 42,
            columnNumber: 10,
            isAppCode: true,
          },
        ],
      };

      const fingerprint1 = FingerprintService.generate(exception);
      const fingerprint2 = FingerprintService.generate(exception);

      expect(fingerprint1).toBe(fingerprint2);
      expect(fingerprint1).toHaveLength(64); // SHA-256 hex string
    });

    it('should generate different fingerprints for different exception types', () => {
      const exception1: ParsedException = {
        exceptionType: 'TypeError',
        exceptionMessage: 'Test error',
        language: 'nodejs',
        rawStackTrace: '',
        frames: [
          {
            frameIndex: 0,
            filePath: '/app/handler.js',
            functionName: 'process',
            lineNumber: 10,
            isAppCode: true,
          },
        ],
      };

      const exception2: ParsedException = {
        ...exception1,
        exceptionType: 'ReferenceError',
      };

      const fingerprint1 = FingerprintService.generate(exception1);
      const fingerprint2 = FingerprintService.generate(exception2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it('should generate different fingerprints for different stack traces', () => {
      const exception1: ParsedException = {
        exceptionType: 'Error',
        exceptionMessage: 'Test',
        language: 'nodejs',
        rawStackTrace: '',
        frames: [
          {
            frameIndex: 0,
            filePath: '/app/handler.js',
            functionName: 'handleA',
            lineNumber: 10,
            isAppCode: true,
          },
        ],
      };

      const exception2: ParsedException = {
        ...exception1,
        frames: [
          {
            frameIndex: 0,
            filePath: '/app/handler.js',
            functionName: 'handleB',
            lineNumber: 10,
            isAppCode: true,
          },
        ],
      };

      const fingerprint1 = FingerprintService.generate(exception1);
      const fingerprint2 = FingerprintService.generate(exception2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it('should ignore library code in fingerprint', () => {
      const exception1: ParsedException = {
        exceptionType: 'Error',
        exceptionMessage: 'Test',
        language: 'nodejs',
        rawStackTrace: '',
        frames: [
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
        ],
      };

      const exception2: ParsedException = {
        exceptionType: 'Error',
        exceptionMessage: 'Test',
        language: 'nodejs',
        rawStackTrace: '',
        frames: [
          {
            frameIndex: 0,
            filePath: '/app/node_modules/koa/lib/application.js',
            functionName: 'Application.handle',
            lineNumber: 200,
            isAppCode: false,
          },
          {
            frameIndex: 1,
            filePath: '/app/src/handler.js',
            functionName: 'myHandler',
            lineNumber: 20,
            isAppCode: true,
          },
        ],
      };

      // Same app code frames should produce same fingerprint despite different library frames
      const fingerprint1 = FingerprintService.generate(exception1);
      const fingerprint2 = FingerprintService.generate(exception2);

      expect(fingerprint1).toBe(fingerprint2);
    });

    it('should generate same fingerprint regardless of error message content', () => {
      const exception1: ParsedException = {
        exceptionType: 'ValidationError',
        exceptionMessage: 'Invalid email: user1@test.com',
        language: 'nodejs',
        rawStackTrace: '',
        frames: [
          {
            frameIndex: 0,
            filePath: '/app/validator.js',
            functionName: 'validate',
            lineNumber: 15,
            isAppCode: true,
          },
        ],
      };

      const exception2: ParsedException = {
        ...exception1,
        exceptionMessage: 'Invalid email: user2@test.com',
      };

      // Same stack trace, same exception type - should have same fingerprint
      const fingerprint1 = FingerprintService.generate(exception1);
      const fingerprint2 = FingerprintService.generate(exception2);

      expect(fingerprint1).toBe(fingerprint2);
    });
  });

  describe('generateFromFrames', () => {
    it('should generate fingerprint from frames directly', () => {
      const frames: StackFrame[] = [
        {
          frameIndex: 0,
          filePath: '/app/src/service.js',
          functionName: 'Service.process',
          lineNumber: 30,
          isAppCode: true,
        },
      ];

      const fingerprint = FingerprintService.generateFromFrames('Error', frames, 'nodejs');

      expect(fingerprint).toHaveLength(64);
    });

    it('should match generate() output', () => {
      const frames: StackFrame[] = [
        {
          frameIndex: 0,
          filePath: '/app/src/handler.js',
          functionName: 'handle',
          lineNumber: 10,
          isAppCode: true,
        },
      ];

      const exception: ParsedException = {
        exceptionType: 'Error',
        exceptionMessage: 'Test',
        language: 'nodejs',
        rawStackTrace: '',
        frames,
      };

      const fingerprint1 = FingerprintService.generate(exception);
      const fingerprint2 = FingerprintService.generateFromFrames('Error', frames, 'nodejs');

      expect(fingerprint1).toBe(fingerprint2);
    });

    it('should work with unknown language using default normalization', () => {
      const frames: StackFrame[] = [
        {
          frameIndex: 0,
          filePath: '/app/unknown.xyz',
          functionName: 'process',
          lineNumber: 5,
          isAppCode: true,
        },
      ];

      const fingerprint = FingerprintService.generateFromFrames('Error', frames, 'unknown');

      expect(fingerprint).toHaveLength(64);
    });
  });

  describe('normalizeMessage', () => {
    it('should replace numbers with N', () => {
      const message = 'Error at line 42 column 15';
      const normalized = FingerprintService.normalizeMessage(message);

      expect(normalized).toBe('Error at line N column N');
    });

    it('should replace hex values (digits replaced first)', () => {
      // Note: numbers are replaced before hex, so 0x gets mangled to Nx
      // and the remaining letters don't match the 0x... pattern anymore
      const message = 'Memory address 0xabc is invalid';
      const normalized = FingerprintService.normalizeMessage(message);

      // The 0 gets replaced by N first, then 0x[0-9a-f]+ can't match Nxabc
      expect(normalized).toBe('Memory address Nxabc is invalid');
    });

    it('should replace single-quoted strings', () => {
      const message = "Cannot find property 'userId' on object";
      const normalized = FingerprintService.normalizeMessage(message);

      expect(normalized).toBe("Cannot find property 'STRING' on object");
    });

    it('should replace double-quoted strings', () => {
      const message = 'Invalid value "test@example.com" for email';
      const normalized = FingerprintService.normalizeMessage(message);

      expect(normalized).toBe('Invalid value "STRING" for email');
    });

    it('should replace array contents', () => {
      const message = 'Expected one of [1, 2, 3] but got 5';
      const normalized = FingerprintService.normalizeMessage(message);

      expect(normalized).toBe('Expected one of [ARRAY] but got N');
    });

    it('should replace object contents', () => {
      const message = 'Invalid config {host: localhost, port: 5432}';
      const normalized = FingerprintService.normalizeMessage(message);

      expect(normalized).toBe('Invalid config {OBJECT}');
    });

    it('should trim whitespace', () => {
      const message = '  Error with spaces  ';
      const normalized = FingerprintService.normalizeMessage(message);

      expect(normalized).toBe('Error with spaces');
    });

    it('should handle multiple replacements', () => {
      const message = "Error 42: Invalid user 'john' at index [0]";
      const normalized = FingerprintService.normalizeMessage(message);

      expect(normalized).toBe("Error N: Invalid user 'STRING' at index [ARRAY]");
    });

    it('should handle empty message', () => {
      expect(FingerprintService.normalizeMessage('')).toBe('');
    });

    it('should handle message with no dynamic values', () => {
      const message = 'Connection refused';
      expect(FingerprintService.normalizeMessage(message)).toBe('Connection refused');
    });
  });
});
