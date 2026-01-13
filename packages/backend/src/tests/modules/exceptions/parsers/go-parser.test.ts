import { describe, it, expect } from 'vitest';
import { GoExceptionParser } from '../../../../modules/exceptions/parsers/go-parser.js';

describe('GoExceptionParser', () => {
  const parser = new GoExceptionParser();

  describe('canParse', () => {
    it('should return true for valid panic with goroutine', () => {
      const message = `panic: runtime error: invalid memory address or nil pointer dereference

goroutine 1 [running]:
main.handler()
	/app/main.go:42 +0x123`;
      expect(parser.canParse(message)).toBe(true);
    });

    it('should return true for runtime error with goroutine', () => {
      const message = `runtime error: index out of range [5] with length 3

goroutine 1 [running]:
main.processSlice()
	/app/processor.go:25 +0x456`;
      expect(parser.canParse(message)).toBe(true);
    });

    it('should return false for empty message', () => {
      expect(parser.canParse('')).toBe(false);
    });

    it('should return false for null/undefined message', () => {
      expect(parser.canParse(null as any)).toBe(false);
      expect(parser.canParse(undefined as any)).toBe(false);
    });

    it('should return false for non-Go stack trace', () => {
      const nodeMessage = `Error: Something failed
    at Object.<anonymous> (/app/index.js:10:15)
    at Module._compile (internal/modules/cjs/loader.js:999:30)`;
      expect(parser.canParse(nodeMessage)).toBe(false);
    });

    it('should return false for panic without goroutine', () => {
      const message = `panic: something went wrong`;
      expect(parser.canParse(message)).toBe(false);
    });

    it('should return false for goroutine without panic', () => {
      const message = `goroutine 1 [running]:
main.handler()
	/app/main.go:42 +0x123`;
      expect(parser.canParse(message)).toBe(false);
    });
  });

  describe('parse', () => {
    it('should parse basic panic', () => {
      const message = `panic: something went wrong

goroutine 1 [running]:
main.handleRequest()
	/app/server.go:42 +0x123
main.main()
	/app/main.go:10 +0x456`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('panic');
      expect(result!.exceptionMessage).toBe('something went wrong');
      expect(result!.language).toBe('go');
      expect(result!.frames).toHaveLength(2);
      expect(result!.frames[0].filePath).toBe('/app/server.go');
      expect(result!.frames[0].lineNumber).toBe(42);
      expect(result!.frames[0].functionName).toBe('main.handleRequest');
    });

    it('should parse runtime error', () => {
      const message = `runtime error: slice bounds out of range

goroutine 1 [running]:
main.processData()
	/app/processor.go:50 +0x789`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('runtime error');
      expect(result!.exceptionMessage).toBe('slice bounds out of range');
    });

    it('should parse nested package functions', () => {
      const message = `panic: error occurred

goroutine 1 [running]:
github.com/myorg/myapp/internal/service.Process()
	/go/src/github.com/myorg/myapp/internal/service/handler.go:100 +0x123`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].functionName).toBe('service.Process');
      expect(result!.frames[0].metadata?.fullFunctionName).toBe('github.com/myorg/myapp/internal/service.Process');
    });

    it('should detect GOROOT library paths', () => {
      const message = `panic: test

goroutine 1 [running]:
runtime.throw()
	$GOROOT/src/runtime/panic.go:1198 +0x71
main.handler()
	/app/main.go:10 +0x123`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].isAppCode).toBe(false); // GOROOT path
      expect(result!.frames[1].isAppCode).toBe(true); // app code
    });

    it('should detect vendor paths as library', () => {
      const message = `panic: error

goroutine 1 [running]:
github.com/mylib/gin.handleHTTPRequest()
	/app/vendor/github.com/mylib/gin/gin.go:400 +0x456
main.main()
	/app/main.go:20 +0x789`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].isAppCode).toBe(false); // vendor path
      expect(result!.frames[1].isAppCode).toBe(true);
    });

    it('should detect go/pkg/mod paths as library', () => {
      const message = `panic: error

goroutine 1 [running]:
github.com/lib/pq.Close()
	/home/user/go/pkg/mod/github.com/lib/pq@v1.10.0/conn.go:50 +0x123
main.cleanup()
	/app/main.go:30 +0x456`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].isAppCode).toBe(false); // go/pkg/mod path
    });

    it('should detect runtime paths as library', () => {
      const message = `panic: error

goroutine 1 [running]:
runtime/internal/atomic.(*Uint64).Load()
	/usr/local/go/src/runtime/internal/atomic/atomic_amd64.go:10 +0x5
main.process()
	/app/main.go:15 +0x123`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].isAppCode).toBe(false); // runtime path
    });

    it('should return null for unparseable message', () => {
      const result = parser.parse('random text without stack trace');
      expect(result).toBeNull();
    });

    it('should return null when no frames are parsed', () => {
      const message = `panic: error

goroutine 1 [running]:`;

      const result = parser.parse(message);
      expect(result).toBeNull();
    });

    it('should stop parsing at empty line after frames', () => {
      const message = `panic: first error

goroutine 1 [running]:
main.first()
	/app/first.go:10 +0x123

panic: second error

goroutine 2 [running]:
main.second()
	/app/second.go:20 +0x456`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames).toHaveLength(1);
      expect(result!.frames[0].functionName).toBe('main.first');
    });

    it('should preserve raw stack trace', () => {
      const message = `panic: test error

goroutine 1 [running]:
main.test()
	/app/test.go:5 +0x100`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.rawStackTrace).toBe(message);
    });

    it('should handle multiple goroutines (only parse first)', () => {
      const message = `panic: concurrent access

goroutine 5 [running]:
main.writer()
	/app/writer.go:20 +0x100

goroutine 6 [running]:
main.reader()
	/app/reader.go:30 +0x200`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      // Should only get frames from the first goroutine section
      expect(result!.frames[0].functionName).toBe('main.writer');
    });
  });
});
