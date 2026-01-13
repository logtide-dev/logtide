import { describe, it, expect } from 'vitest';
import { PHPExceptionParser } from '../../../../modules/exceptions/parsers/php-parser.js';

describe('PHPExceptionParser', () => {
  const parser = new PHPExceptionParser();

  describe('canParse', () => {
    it('should return true for valid PHP fatal error with stack trace', () => {
      const message = `Uncaught RuntimeException: Something went wrong in /var/www/app/src/Service.php:42
Stack trace:
#0 /var/www/app/src/Controller.php(10): Service->process()
#1 {main}`;
      expect(parser.canParse(message)).toBe(true);
    });

    it('should return true for uncaught exception', () => {
      const message = `Uncaught InvalidArgumentException: Invalid input provided in /app/src/Validator.php:25
Stack trace:
#0 /app/src/Handler.php(15): Validator->validate()
#1 {main}`;
      expect(parser.canParse(message)).toBe(true);
    });

    it('should return false for empty message', () => {
      expect(parser.canParse('')).toBe(false);
    });

    it('should return false for null/undefined message', () => {
      expect(parser.canParse(null as any)).toBe(false);
      expect(parser.canParse(undefined as any)).toBe(false);
    });

    it('should return false for non-PHP stack trace', () => {
      const nodeMessage = `Error: Something failed
    at Object.<anonymous> (/app/index.js:10:15)
    at Module._compile (internal/modules/cjs/loader.js:999:30)`;
      expect(parser.canParse(nodeMessage)).toBe(false);
    });

    it('should return false for message without stack trace', () => {
      const message = `Uncaught RuntimeException: Something went wrong in /var/www/app/src/Service.php:42`;
      expect(parser.canParse(message)).toBe(false);
    });
  });

  describe('parse', () => {
    it('should parse basic PHP exception', () => {
      const message = `Uncaught RuntimeException: Database connection failed in /var/www/app/src/Database.php:42
Stack trace:
#0 /var/www/app/src/Repository.php(25): Database->connect()
#1 /var/www/app/src/Controller.php(10): Repository->findAll()
#2 {main}`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('RuntimeException');
      expect(result!.exceptionMessage).toBe('Database connection failed');
      expect(result!.language).toBe('php');
      expect(result!.frames).toHaveLength(2);
      expect(result!.frames[0].frameIndex).toBe(0);
      expect(result!.frames[0].filePath).toBe('/var/www/app/src/Repository.php');
      expect(result!.frames[0].lineNumber).toBe(25);
      expect(result!.frames[0].functionName).toBe('Database::connect');
    });

    it('should parse namespaced exception types', () => {
      const message = `Uncaught App\\Exceptions\\ValidationException: Invalid email format in /var/www/app/src/Validator.php:30
Stack trace:
#0 /var/www/app/src/Handler.php(15): Validator->validateEmail()
#1 {main}`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('ValidationException');
      expect(result!.exceptionMessage).toBe('Invalid email format');
    });

    it('should parse static method calls', () => {
      const message = `Uncaught RuntimeException: Config not found in /app/src/Config.php:50
Stack trace:
#0 /app/src/Bootstrap.php(20): Config::load()
#1 {main}`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].functionName).toBe('Config::load');
      expect(result!.frames[0].metadata?.className).toBe('Config');
      expect(result!.frames[0].metadata?.methodName).toBe('load');
    });

    it('should parse instance method calls', () => {
      const message = `Uncaught RuntimeException: Method failed in /app/src/Service.php:30
Stack trace:
#0 /app/src/Controller.php(15): UserService->createUser()
#1 {main}`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].functionName).toBe('UserService::createUser');
      expect(result!.frames[0].metadata?.className).toBe('UserService');
      expect(result!.frames[0].metadata?.methodName).toBe('createUser');
    });

    it('should detect library paths correctly', () => {
      const message = `Uncaught RuntimeException: Error in /app/src/Service.php:10
Stack trace:
#0 /var/www/vendor/laravel/framework/src/Http/Controller.php(50): Service->handle()
#1 /app/src/MyController.php(20): Illuminate\\Routing\\Controller->dispatch()
#2 {main}`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].isAppCode).toBe(false); // vendor path
      expect(result!.frames[1].isAppCode).toBe(true); // app code
    });

    it('should return null for unparseable message', () => {
      const result = parser.parse('random text without stack trace');
      expect(result).toBeNull();
    });

    it('should return null when no frames are parsed', () => {
      const message = `Uncaught RuntimeException: Error in /app/src/Service.php:10
Stack trace:
#0 {main}`;

      const result = parser.parse(message);
      expect(result).toBeNull();
    });

    it('should handle function call without class', () => {
      const message = `Uncaught RuntimeError: Error in /app/src/functions.php:10
Stack trace:
#0 /app/src/index.php(5): processData()
#1 {main}`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].functionName).toBe('processData');
    });

    it('should detect Symfony library paths', () => {
      const message = `Uncaught RuntimeError: Error in /app/src/Service.php:10
Stack trace:
#0 /var/www/vendor/Symfony/Component/HttpKernel/Kernel.php(100): Service->handle()
#1 {main}`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].isAppCode).toBe(false);
    });

    it('should detect phar paths as library', () => {
      const message = `Uncaught RuntimeError: Error in /app/src/Service.php:10
Stack trace:
#0 phar:///composer.phar/src/Composer.php(50): Service->handle()
#1 {main}`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].isAppCode).toBe(false);
    });

    it('should preserve raw stack trace', () => {
      const message = `Uncaught RuntimeError: Test in /app/src/Test.php:1
Stack trace:
#0 /app/src/Main.php(5): Test->run()
#1 {main}`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.rawStackTrace).toBe(message);
    });
  });
});
