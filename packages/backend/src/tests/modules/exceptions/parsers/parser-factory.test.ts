import { describe, it, expect } from 'vitest';
import { ParserFactory } from '../../../../modules/exceptions/parsers/parser-factory.js';

describe('ParserFactory', () => {
  describe('detectParser', () => {
    it('should return NodeJS parser for V8 stack trace', () => {
      const message = `Error: Connection refused
    at Database.connect (/app/src/db.js:42:15)
    at Repository.init (/app/src/repo.js:10:20)`;

      const parser = ParserFactory.detectParser(message);

      expect(parser).not.toBeNull();
      expect(parser!.language).toBe('nodejs');
    });

    it('should return Python parser for Python traceback', () => {
      const message = `Traceback (most recent call last):
  File "/app/main.py", line 10, in <module>
    result = process_data()
  File "/app/processor.py", line 25, in process_data
    raise ValueError("Invalid data")
ValueError: Invalid data`;

      const parser = ParserFactory.detectParser(message);

      expect(parser).not.toBeNull();
      expect(parser!.language).toBe('python');
    });

    it('should return Java parser for Java exception', () => {
      const message = `java.lang.NullPointerException: Cannot invoke method on null
	at com.example.Service.process(Service.java:42)
	at com.example.Controller.handle(Controller.java:10)`;

      const parser = ParserFactory.detectParser(message);

      expect(parser).not.toBeNull();
      expect(parser!.language).toBe('java');
    });

    it('should return Go parser for Go panic', () => {
      const message = `panic: runtime error: invalid memory address

goroutine 1 [running]:
main.handler()
	/app/main.go:42 +0x123`;

      const parser = ParserFactory.detectParser(message);

      expect(parser).not.toBeNull();
      expect(parser!.language).toBe('go');
    });

    it('should return PHP parser for PHP exception', () => {
      const message = `Fatal error: Uncaught Exception: Database error in /app/src/Service.php:42
Stack trace:
#0 /app/src/Controller.php(10): Service->connect()
#1 {main}`;

      const parser = ParserFactory.detectParser(message);

      expect(parser).not.toBeNull();
      expect(parser!.language).toBe('php');
    });

    it('should return null for empty message', () => {
      expect(ParserFactory.detectParser('')).toBeNull();
    });

    it('should return null for null/undefined', () => {
      expect(ParserFactory.detectParser(null as any)).toBeNull();
      expect(ParserFactory.detectParser(undefined as any)).toBeNull();
    });

    it('should return null for unrecognized format', () => {
      const message = 'This is just a regular log message without any stack trace';
      expect(ParserFactory.detectParser(message)).toBeNull();
    });
  });

  describe('detectLanguage', () => {
    it('should detect nodejs language', () => {
      const message = `TypeError: Cannot read property 'x' of undefined
    at process (/app/index.js:5:10)`;

      expect(ParserFactory.detectLanguage(message)).toBe('nodejs');
    });

    it('should detect python language', () => {
      const message = `Traceback (most recent call last):
  File "main.py", line 1, in <module>
KeyError: 'missing'`;

      expect(ParserFactory.detectLanguage(message)).toBe('python');
    });

    it('should detect java language', () => {
      const message = `java.lang.IllegalArgumentException: Invalid input
	at com.example.Validator.check(Validator.java:20)`;

      expect(ParserFactory.detectLanguage(message)).toBe('java');
    });

    it('should detect go language', () => {
      const message = `panic: index out of range

goroutine 1 [running]:
main.process()
	/app/main.go:10 +0x100`;

      expect(ParserFactory.detectLanguage(message)).toBe('go');
    });

    it('should detect php language', () => {
      const message = `Uncaught InvalidArgumentException: Bad value in /app/Validator.php:15
Stack trace:
#0 /app/Handler.php(20): Validator->check()
#1 {main}`;

      expect(ParserFactory.detectLanguage(message)).toBe('php');
    });

    it('should return null for unknown format', () => {
      expect(ParserFactory.detectLanguage('just a message')).toBeNull();
    });
  });

  describe('parse', () => {
    it('should auto-detect and parse NodeJS error', () => {
      const message = `Error: Test error
    at testFunction (/app/test.js:10:5)`;

      const result = ParserFactory.parse(message);

      expect(result).not.toBeNull();
      expect(result!.language).toBe('nodejs');
      expect(result!.exceptionType).toBe('Error');
    });

    it('should auto-detect and parse Python error', () => {
      const message = `Traceback (most recent call last):
  File "/app/main.py", line 5, in <module>
    raise RuntimeError("Test")
RuntimeError: Test`;

      const result = ParserFactory.parse(message);

      expect(result).not.toBeNull();
      expect(result!.language).toBe('python');
      expect(result!.exceptionType).toBe('RuntimeError');
    });

    it('should return null for unparseable message', () => {
      expect(ParserFactory.parse('random text')).toBeNull();
    });

    it('should return null for empty message', () => {
      expect(ParserFactory.parse('')).toBeNull();
    });
  });

  describe('parseWithLanguage', () => {
    it('should parse with specific nodejs parser', () => {
      const message = `Error: Specific error
    at handler (/app/handler.js:20:10)`;

      const result = ParserFactory.parseWithLanguage(message, 'nodejs');

      expect(result).not.toBeNull();
      expect(result!.language).toBe('nodejs');
    });

    it('should parse with specific java parser', () => {
      const message = `java.lang.RuntimeException: Java error
	at com.example.Main.run(Main.java:10)`;

      const result = ParserFactory.parseWithLanguage(message, 'java');

      expect(result).not.toBeNull();
      expect(result!.language).toBe('java');
    });

    it('should return null if parser cannot parse the message', () => {
      const nodeMessage = `Error: Node error
    at handler (/app/handler.js:20:10)`;

      // Try to parse Node message with Java parser
      const result = ParserFactory.parseWithLanguage(nodeMessage, 'java');

      expect(result).toBeNull();
    });

    it('should return null for unknown language', () => {
      const result = ParserFactory.parseWithLanguage('test', 'unknown' as any);
      expect(result).toBeNull();
    });
  });

  describe('getParser', () => {
    it('should return parser for nodejs', () => {
      const parser = ParserFactory.getParser('nodejs');
      expect(parser).not.toBeNull();
      expect(parser!.language).toBe('nodejs');
    });

    it('should return parser for python', () => {
      const parser = ParserFactory.getParser('python');
      expect(parser).not.toBeNull();
      expect(parser!.language).toBe('python');
    });

    it('should return parser for java', () => {
      const parser = ParserFactory.getParser('java');
      expect(parser).not.toBeNull();
      expect(parser!.language).toBe('java');
    });

    it('should return parser for go', () => {
      const parser = ParserFactory.getParser('go');
      expect(parser).not.toBeNull();
      expect(parser!.language).toBe('go');
    });

    it('should return parser for php', () => {
      const parser = ParserFactory.getParser('php');
      expect(parser).not.toBeNull();
      expect(parser!.language).toBe('php');
    });

    it('should return null for unknown language', () => {
      const parser = ParserFactory.getParser('unknown' as any);
      expect(parser).toBeNull();
    });
  });

  describe('getSupportedLanguages', () => {
    it('should return all supported languages', () => {
      const languages = ParserFactory.getSupportedLanguages();

      expect(languages).toContain('nodejs');
      expect(languages).toContain('python');
      expect(languages).toContain('java');
      expect(languages).toContain('go');
      expect(languages).toContain('php');
      expect(languages).toHaveLength(5);
    });
  });
});
