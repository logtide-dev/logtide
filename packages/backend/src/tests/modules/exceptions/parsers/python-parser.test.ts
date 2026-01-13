import { describe, it, expect } from 'vitest';
import { PythonExceptionParser } from '../../../../modules/exceptions/parsers/python-parser.js';

describe('PythonExceptionParser', () => {
  const parser = new PythonExceptionParser();

  describe('canParse', () => {
    it('should return true for valid Python traceback', () => {
      const message = `Traceback (most recent call last):
  File "/app/main.py", line 10, in <module>
    result = process()
  File "/app/processor.py", line 25, in process
    raise ValueError("Invalid data")
ValueError: Invalid data`;
      expect(parser.canParse(message)).toBe(true);
    });

    it('should return true for simple traceback', () => {
      const message = `Traceback (most recent call last):
  File "test.py", line 1, in <module>
KeyError: 'missing'`;
      expect(parser.canParse(message)).toBe(true);
    });

    it('should return false for empty message', () => {
      expect(parser.canParse('')).toBe(false);
    });

    it('should return false for null/undefined message', () => {
      expect(parser.canParse(null as any)).toBe(false);
      expect(parser.canParse(undefined as any)).toBe(false);
    });

    it('should return false for non-Python stack trace', () => {
      const nodeMessage = `Error: Something failed
    at Object.<anonymous> (/app/index.js:10:15)`;
      expect(parser.canParse(nodeMessage)).toBe(false);
    });

    it('should return false for traceback without frames', () => {
      const message = `Traceback (most recent call last):
Some random text`;
      expect(parser.canParse(message)).toBe(false);
    });
  });

  describe('parse', () => {
    it('should parse basic Python traceback', () => {
      const message = `Traceback (most recent call last):
  File "/app/main.py", line 10, in main
    result = process_data()
  File "/app/processor.py", line 25, in process_data
    raise ValueError("Invalid input")
ValueError: Invalid input`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('ValueError');
      expect(result!.exceptionMessage).toBe('Invalid input');
      expect(result!.language).toBe('python');
      expect(result!.frames).toHaveLength(2);
      // Python frames are reversed (most recent first after parse)
      expect(result!.frames[0].filePath).toBe('/app/processor.py');
      expect(result!.frames[0].lineNumber).toBe(25);
      expect(result!.frames[0].functionName).toBe('process_data');
    });

    it('should parse traceback with code context', () => {
      const message = `Traceback (most recent call last):
  File "/app/handler.py", line 15, in handle
    data['key']
KeyError: 'key'`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames[0].codeContext).toEqual({ line: "data['key']" });
    });

    it('should parse module-level errors', () => {
      const message = `Traceback (most recent call last):
  File "/app/script.py", line 5, in <module>
    import nonexistent
ModuleNotFoundError: No module named 'nonexistent'`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('ModuleNotFoundError');
      expect(result!.frames[0].functionName).toBe('<module>');
    });

    it('should detect library paths', () => {
      const message = `Traceback (most recent call last):
  File "/usr/lib/python3.9/site-packages/django/core/handlers/base.py", line 100, in get_response
    response = self._middleware_chain(request)
  File "/app/views.py", line 20, in my_view
    raise RuntimeError("error")
RuntimeError: error`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      // Python reverses frames, so index 0 is the most recent (app/views.py)
      expect(result!.frames[0].isAppCode).toBe(true); // app/views.py (most recent)
      expect(result!.frames[1].isAppCode).toBe(false); // site-packages
    });

    it('should detect venv paths as library', () => {
      const message = `Traceback (most recent call last):
  File "/app/.venv/lib/python3.9/site-packages/requests/api.py", line 50, in get
    return request('get', url)
  File "/app/main.py", line 10, in fetch
    raise HTTPError("Failed")
HTTPError: Failed`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.frames.some((f) => !f.isAppCode)).toBe(true);
    });

    it('should stop at chained exception', () => {
      const message = `Traceback (most recent call last):
  File "/app/main.py", line 5, in main
    process()
  File "/app/processor.py", line 10, in process
    raise ValueError("first error")
ValueError: first error

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/app/main.py", line 7, in main
    cleanup()
RuntimeError: cleanup failed`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      // Should only have frames from the first traceback
      expect(result!.exceptionType).toBe('ValueError');
      expect(result!.frames.length).toBe(2);
    });

    it('should return null for unparseable message', () => {
      const result = parser.parse('random text without traceback');
      expect(result).toBeNull();
    });

    it('should return null when no frames are parsed', () => {
      const message = `Traceback (most recent call last):
SomeError: error without frames`;

      const result = parser.parse(message);
      expect(result).toBeNull();
    });

    it('should preserve raw stack trace', () => {
      const message = `Traceback (most recent call last):
  File "/app/test.py", line 1, in test
    pass
TestError: test`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.rawStackTrace).toBe(message);
    });

    it('should handle AttributeError', () => {
      const message = `Traceback (most recent call last):
  File "/app/main.py", line 10, in run
    obj.missing_method()
AttributeError: 'MyClass' object has no attribute 'missing_method'`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('AttributeError');
    });

    it('should handle TypeError', () => {
      const message = `Traceback (most recent call last):
  File "/app/calc.py", line 5, in calculate
    result = 'str' + 123
TypeError: can only concatenate str (not "int") to str`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('TypeError');
    });

    it('should handle IndexError', () => {
      const message = `Traceback (most recent call last):
  File "/app/list.py", line 3, in get_item
    return items[10]
IndexError: list index out of range`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('IndexError');
    });

    it('should handle RuntimeError', () => {
      const message = `Traceback (most recent call last):
  File "/app/async.py", line 15, in run_async
    await asyncio.gather(*tasks)
RuntimeError: This event loop is already running`;

      const result = parser.parse(message);

      expect(result).not.toBeNull();
      expect(result!.exceptionType).toBe('RuntimeError');
    });
  });
});
