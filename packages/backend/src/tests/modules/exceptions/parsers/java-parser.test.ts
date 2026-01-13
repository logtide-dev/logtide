import { describe, it, expect } from 'vitest';
import { JavaExceptionParser } from '../../../../modules/exceptions/parsers/java-parser.js';

describe('JavaExceptionParser', () => {
  const parser = new JavaExceptionParser();

  describe('canParse', () => {
    it('should return true for valid Java exception with stack trace', () => {
      const message = `java.lang.NullPointerException: Cannot invoke method on null
	at com.example.Service.process(Service.java:42)
	at com.example.Controller.handle(Controller.java:10)`;
      expect(parser.canParse(message)).toBe(true);
    });

    it('should return true for RuntimeException', () => {
      const message = `java.lang.RuntimeException: Unexpected error
	at com.app.Handler.execute(Handler.java:25)`;
      expect(parser.canParse(message)).toBe(true);
    });

    it('should return true for IOException', () => {
      const message = `java.io.IOException: File not found
	at java.io.FileInputStream.open(FileInputStream.java:100)`;
      expect(parser.canParse(message)).toBe(true);
    });

    it('should return false for empty message', () => {
      expect(parser.canParse('')).toBe(false);
    });

    it('should return false for null/undefined message', () => {
      expect(parser.canParse(null as any)).toBe(false);
      expect(parser.canParse(undefined as any)).toBe(false);
    });

    it('should return false for non-Java stack trace', () => {
      const nodeMessage = `Error: Something failed
    at Object.<anonymous> (/app/index.js:10:15)`;
      expect(parser.canParse(nodeMessage)).toBe(false);
    });

    it('should return false for exception without stack trace', () => {
      const message = `java.lang.NullPointerException: null`;
      expect(parser.canParse(message)).toBe(false);
    });
  });

  describe('parse', () => {
    it('should parse basic NullPointerException', () => {
      const message = `java.lang.NullPointerException: Cannot read property
	at com.example.service.UserService.getUser(UserService.java:42)
	at com.example.controller.UserController.show(UserController.java:20)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('NullPointerException');
      expect(result!.exceptionMessage).toBe('Cannot read property');
      expect(result!.language).toBe('java');
      expect(result!.frames).toHaveLength(2);
      expect(result!.frames[0].functionName).toBe('UserService.getUser');
      expect(result!.frames[0].lineNumber).toBe(42);
    });

    it('should parse exception without message', () => {
      const message = `java.lang.NullPointerException
	at com.example.Service.process(Service.java:10)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('NullPointerException');
      expect(result!.exceptionMessage).toBe('');
    });

    it('should handle Native Method frames', () => {
      const message = `java.lang.RuntimeException: Error
	at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)
	at com.example.Service.call(Service.java:30)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].filePath).toContain('Native Method');
    });

    it('should handle Unknown Source frames', () => {
      const message = `java.lang.RuntimeException: Error
	at com.generated.Proxy.invoke(Unknown Source)
	at com.example.Service.call(Service.java:30)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].filePath).toContain('Unknown Source');
    });

    it('should stop at Caused by section', () => {
      const message = `java.lang.RuntimeException: Wrapper exception
	at com.example.Handler.wrap(Handler.java:50)
Caused by: java.io.IOException: File not found
	at java.io.FileInputStream.open(FileInputStream.java:100)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames).toHaveLength(1);
      expect(result!.frames[0].functionName).toBe('Handler.wrap');
    });

    it('should stop at Suppressed section', () => {
      const message = `java.lang.RuntimeException: Main exception
	at com.example.Main.run(Main.java:30)
	Suppressed: java.io.IOException: Cleanup failed
		at com.example.Resource.close(Resource.java:50)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames).toHaveLength(1);
    });

    it('should handle ... N more frames', () => {
      const message = `java.lang.RuntimeException: Error
	at com.example.Service.process(Service.java:20)
	... 15 more`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames).toHaveLength(1);
    });

    it('should detect Java standard library as library code', () => {
      const message = `java.lang.RuntimeException: Error
	at java.util.HashMap.get(HashMap.java:500)
	at com.example.App.run(App.java:10)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].isAppCode).toBe(false); // java.*
      expect(result!.frames[1].isAppCode).toBe(true);
    });

    it('should detect Spring framework as library code', () => {
      const message = `java.lang.RuntimeException: Error
	at org.springframework.web.servlet.DispatcherServlet.doDispatch(DispatcherServlet.java:1000)
	at com.myapp.Controller.handle(Controller.java:20)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].isAppCode).toBe(false); // Spring
      expect(result!.frames[1].isAppCode).toBe(true);
    });

    it('should detect Apache libraries as library code', () => {
      const message = `java.lang.RuntimeException: Error
	at org.apache.http.impl.client.CloseableHttpClient.execute(CloseableHttpClient.java:100)
	at com.myapp.HttpClient.send(HttpClient.java:50)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].isAppCode).toBe(false); // Apache
    });

    it('should extract class and method metadata', () => {
      const message = `java.lang.RuntimeException: Error
	at com.example.service.UserService.createUser(UserService.java:42)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].metadata?.className).toBe('com.example.service.UserService');
      expect(result!.frames[0].metadata?.methodName).toBe('createUser');
    });

    it('should return null for unparseable message', () => {
      const result = parser.parse('random text without stack trace');
      expect(result).toBeNull();
    });

    it('should return null when no frames are parsed', () => {
      const message = `java.lang.RuntimeException: Error
but no frames here`;

      const result = parser.parse(message);
      expect(result).toBeNull();
    });

    it('should preserve raw stack trace', () => {
      const message = `java.lang.RuntimeException: Test
	at com.example.Test.run(Test.java:1)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.rawStackTrace).toBe(message);
    });

    it('should build correct file path from class name', () => {
      const message = `java.lang.RuntimeException: Error
	at com.example.service.impl.UserServiceImpl.create(UserServiceImpl.java:100)`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].filePath).toBe('com/example/service/impl/UserServiceImpl.java');
    });
  });
});
