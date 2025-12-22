import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestUser, createTestOrganization, createTestProject, createTestLog } from '../../helpers/factories.js';

// Create a shared reference for the mock that will be populated
const mockState = {
  queueAdd: vi.fn().mockResolvedValue({ id: 'job-id' }),
};

// Mock queue connection BEFORE importing anything that uses it
vi.mock('../../../queue/connection.js', () => {
  return {
    createQueue: vi.fn(() => ({
      add: (...args: unknown[]) => mockState.queueAdd(...args),
      close: vi.fn(),
    })),
    createWorker: vi.fn(() => ({
      on: vi.fn(),
      close: vi.fn(),
    })),
    connection: {
      duplicate: vi.fn(() => ({
        subscribe: vi.fn(),
        on: vi.fn(),
        unsubscribe: vi.fn(),
        disconnect: vi.fn(),
      })),
    },
  };
});

// Mock the config module
vi.mock('../../../config/index.js', () => ({
  config: {
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    SMTP_SECURE: false,
    SMTP_USER: 'test@example.com',
    SMTP_PASS: 'password',
    SMTP_FROM: 'noreply@test.com',
    REDIS_URL: 'redis://localhost:6379',
  },
  isSmtpConfigured: vi.fn(() => false),
}));

// Import after mocks
import { processExceptionParsing, type ExceptionParsingJobData } from '../../../queue/jobs/exception-parsing.js';
import type { Job } from 'bullmq';

describe('Exception Parsing Job', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe('processExceptionParsing', () => {
    it('should skip logs without parsable stack traces', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const log = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: 'Simple error message without stack trace',
        service: 'test-service',
      });

      const job = {
        data: {
          logs: [
            {
              id: log.id,
              message: log.message,
              level: 'error' as const,
              service: 'test-service',
            },
          ],
          organizationId: org.id,
          projectId: project.id,
        } as ExceptionParsingJobData,
      } as Job<ExceptionParsingJobData>;

      await processExceptionParsing(job);

      // Should not queue notification for unparsed logs
      expect(mockState.queueAdd).not.toHaveBeenCalled();
    });

    it('should parse Node.js stack traces and create exceptions', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      // Use valid V8 stack trace format
      const nodeStackTrace = `TypeError: Cannot read property 'name' of undefined
    at processUser (/app/src/user.js:25:10)
    at Object.<anonymous> (/app/src/index.js:10:15)`;

      const log = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: nodeStackTrace,
        service: 'api-service',
      });

      const job = {
        data: {
          logs: [
            {
              id: log.id,
              message: log.message,
              level: 'error' as const,
              service: 'api-service',
            },
          ],
          organizationId: org.id,
          projectId: project.id,
        } as ExceptionParsingJobData,
      } as Job<ExceptionParsingJobData>;

      await processExceptionParsing(job);

      // Check that exception was created
      const exception = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('log_id', '=', log.id)
        .executeTakeFirst();

      expect(exception).toBeDefined();
      expect(exception?.exception_type).toBe('TypeError');
      expect(exception?.exception_message).toBe("Cannot read property 'name' of undefined");
      expect(exception?.language).toBe('nodejs');

      // Check that notification was queued
      expect(mockState.queueAdd).toHaveBeenCalledWith(
        'error-notification',
        expect.objectContaining({
          exceptionType: 'TypeError',
          exceptionMessage: "Cannot read property 'name' of undefined",
          language: 'nodejs',
          service: 'api-service',
          isNewErrorGroup: true,
        }),
        expect.objectContaining({
          delay: 2000,
        })
      );
    });

    it('should parse Python stack traces and create exceptions', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const pythonStackTrace = `Traceback (most recent call last):
  File "/app/main.py", line 10, in <module>
    result = divide(10, 0)
  File "/app/utils.py", line 5, in divide
    return a / b
ZeroDivisionError: division by zero`;

      const log = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: pythonStackTrace,
        service: 'python-service',
      });

      const job = {
        data: {
          logs: [
            {
              id: log.id,
              message: log.message,
              level: 'error' as const,
              service: 'python-service',
            },
          ],
          organizationId: org.id,
          projectId: project.id,
        } as ExceptionParsingJobData,
      } as Job<ExceptionParsingJobData>;

      await processExceptionParsing(job);

      // Check that exception was created
      const exception = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('log_id', '=', log.id)
        .executeTakeFirst();

      expect(exception).toBeDefined();
      expect(exception?.exception_type).toBe('ZeroDivisionError');
      expect(exception?.language).toBe('python');

      // Check that notification was queued
      expect(mockState.queueAdd).toHaveBeenCalledWith(
        'error-notification',
        expect.objectContaining({
          exceptionType: 'ZeroDivisionError',
          language: 'python',
          isNewErrorGroup: true,
        }),
        expect.any(Object)
      );
    });

    it('should skip already parsed logs', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const nodeStackTrace = `TypeError: Cannot read property 'x' of undefined
    at handler (/app/src/handler.js:15:20)
    at main (/app/src/index.js:10:5)`;

      const log = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: nodeStackTrace,
        service: 'test-service',
      });

      // First parse
      const job1 = {
        data: {
          logs: [
            {
              id: log.id,
              message: log.message,
              level: 'error' as const,
              service: 'test-service',
            },
          ],
          organizationId: org.id,
          projectId: project.id,
        } as ExceptionParsingJobData,
      } as Job<ExceptionParsingJobData>;

      await processExceptionParsing(job1);

      // Get count of exceptions before second parse
      const countBefore = await db
        .selectFrom('exceptions')
        .select(({ fn }) => fn.count<number>('id').as('count'))
        .where('log_id', '=', log.id)
        .executeTakeFirst();

      vi.clearAllMocks();

      // Second parse (should be skipped)
      const job2 = {
        data: {
          logs: [
            {
              id: log.id,
              message: log.message,
              level: 'error' as const,
              service: 'test-service',
            },
          ],
          organizationId: org.id,
          projectId: project.id,
        } as ExceptionParsingJobData,
      } as Job<ExceptionParsingJobData>;

      await processExceptionParsing(job2);

      // Get count after second parse
      const countAfter = await db
        .selectFrom('exceptions')
        .select(({ fn }) => fn.count<number>('id').as('count'))
        .where('log_id', '=', log.id)
        .executeTakeFirst();

      // Should still have same number of exceptions
      expect(countAfter?.count).toBe(countBefore?.count);

      // Should not queue notification for already-parsed log
      expect(mockState.queueAdd).not.toHaveBeenCalled();
    });

    it('should handle multiple logs in a batch', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const nodeStackTrace1 = `ReferenceError: x is not defined
    at processData (/app/src/file1.js:10:15)
    at main (/app/src/index.js:5:5)`;

      const nodeStackTrace2 = `SyntaxError: Unexpected token
    at parseJSON (/app/src/file2.js:20:25)
    at handler (/app/src/api.js:30:10)`;

      const simpleMessage = 'Simple error without stack trace';

      const log1 = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: nodeStackTrace1,
        service: 'service-1',
      });

      const log2 = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: nodeStackTrace2,
        service: 'service-2',
      });

      const log3 = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: simpleMessage,
        service: 'service-3',
      });

      const job = {
        data: {
          logs: [
            { id: log1.id, message: log1.message, level: 'error' as const, service: 'service-1' },
            { id: log2.id, message: log2.message, level: 'error' as const, service: 'service-2' },
            { id: log3.id, message: log3.message, level: 'error' as const, service: 'service-3' },
          ],
          organizationId: org.id,
          projectId: project.id,
        } as ExceptionParsingJobData,
      } as Job<ExceptionParsingJobData>;

      await processExceptionParsing(job);

      // Check exceptions were created for parsable logs
      const exceptions = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('log_id', 'in', [log1.id, log2.id, log3.id])
        .execute();

      expect(exceptions.length).toBe(2); // Only 2 parsable logs

      // Check notifications were queued for each parsed exception
      expect(mockState.queueAdd).toHaveBeenCalledTimes(2);
    });

    it('should set isNewErrorGroup to false for existing error groups', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      // Use Python stack trace which works reliably
      const pythonStackTrace = `Traceback (most recent call last):
  File "/app/repeat.py", line 10, in <module>
    do_something()
ValueError: Repeated error`;

      const log1 = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: pythonStackTrace,
        service: 'test-service',
      });

      const log2 = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: pythonStackTrace, // Same message generates same fingerprint
        service: 'test-service',
      });

      // First parse - new error group
      const job1 = {
        data: {
          logs: [
            { id: log1.id, message: log1.message, level: 'error' as const, service: 'test-service' },
          ],
          organizationId: org.id,
          projectId: project.id,
        } as ExceptionParsingJobData,
      } as Job<ExceptionParsingJobData>;

      await processExceptionParsing(job1);

      expect(mockState.queueAdd).toHaveBeenCalledWith(
        'error-notification',
        expect.objectContaining({
          isNewErrorGroup: true,
        }),
        expect.any(Object)
      );

      vi.clearAllMocks();
      mockState.queueAdd.mockResolvedValue({ id: 'job-id' });

      // Second parse - existing error group
      const job2 = {
        data: {
          logs: [
            { id: log2.id, message: log2.message, level: 'error' as const, service: 'test-service' },
          ],
          organizationId: org.id,
          projectId: project.id,
        } as ExceptionParsingJobData,
      } as Job<ExceptionParsingJobData>;

      await processExceptionParsing(job2);

      expect(mockState.queueAdd).toHaveBeenCalledWith(
        'error-notification',
        expect.objectContaining({
          isNewErrorGroup: false,
        }),
        expect.any(Object)
      );
    });

    it('should handle empty logs array', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const job = {
        data: {
          logs: [],
          organizationId: org.id,
          projectId: project.id,
        } as ExceptionParsingJobData,
      } as Job<ExceptionParsingJobData>;

      await processExceptionParsing(job);

      // Should not throw and should not queue any notifications
      expect(mockState.queueAdd).not.toHaveBeenCalled();
    });

    it('should handle Java stack traces', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const javaStackTrace = `java.lang.NullPointerException: Cannot invoke method on null object
    at com.example.MyClass.doSomething(MyClass.java:42)
    at com.example.Main.main(Main.java:15)`;

      const log = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: javaStackTrace,
        service: 'java-service',
      });

      const job = {
        data: {
          logs: [
            { id: log.id, message: log.message, level: 'error' as const, service: 'java-service' },
          ],
          organizationId: org.id,
          projectId: project.id,
        } as ExceptionParsingJobData,
      } as Job<ExceptionParsingJobData>;

      await processExceptionParsing(job);

      const exception = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('log_id', '=', log.id)
        .executeTakeFirst();

      expect(exception).toBeDefined();
      // Java parser extracts just the exception class name without package
      expect(exception?.exception_type).toBe('NullPointerException');
      expect(exception?.language).toBe('java');

      expect(mockState.queueAdd).toHaveBeenCalledWith(
        'error-notification',
        expect.objectContaining({
          exceptionType: 'NullPointerException',
          language: 'java',
        }),
        expect.any(Object)
      );
    });

    it('should continue processing even if notification queueing fails', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      // Use Python stack traces which work reliably
      const pythonStackTrace1 = `Traceback (most recent call last):
  File "/app/first.py", line 10, in <module>
    first_func()
RuntimeError: First error`;

      const pythonStackTrace2 = `Traceback (most recent call last):
  File "/app/second.py", line 20, in <module>
    second_func()
RuntimeError: Second error`;

      const log1 = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: pythonStackTrace1,
        service: 'service-1',
      });

      const log2 = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: pythonStackTrace2,
        service: 'service-2',
      });

      // Make the first notification fail
      mockState.queueAdd.mockRejectedValueOnce(new Error('Queue error'));
      mockState.queueAdd.mockResolvedValueOnce({ id: 'job-id' });

      const job = {
        data: {
          logs: [
            { id: log1.id, message: log1.message, level: 'error' as const, service: 'service-1' },
            { id: log2.id, message: log2.message, level: 'error' as const, service: 'service-2' },
          ],
          organizationId: org.id,
          projectId: project.id,
        } as ExceptionParsingJobData,
      } as Job<ExceptionParsingJobData>;

      // Should not throw
      await processExceptionParsing(job);

      // Both exceptions should still be created
      const exceptions = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('log_id', 'in', [log1.id, log2.id])
        .execute();

      expect(exceptions.length).toBe(2);

      // Queue was called twice (even though first failed)
      expect(mockState.queueAdd).toHaveBeenCalledTimes(2);
    });

    it('should create stack frames for parsed exceptions', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      const nodeStackTrace = `TypeError: Cannot read property 'name' of null
    at processUser (/app/src/user.js:25:10)
    at getUser (/app/src/controller.js:42:15)
    at handle (/app/node_modules/express/router.js:174:12)`;

      const log = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: nodeStackTrace,
        service: 'api-service',
      });

      const job = {
        data: {
          logs: [
            { id: log.id, message: log.message, level: 'error' as const, service: 'api-service' },
          ],
          organizationId: org.id,
          projectId: project.id,
        } as ExceptionParsingJobData,
      } as Job<ExceptionParsingJobData>;

      await processExceptionParsing(job);

      // Get exception
      const exception = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('log_id', '=', log.id)
        .executeTakeFirst();

      expect(exception).toBeDefined();

      // Get stack frames
      const frames = await db
        .selectFrom('stack_frames')
        .selectAll()
        .where('exception_id', '=', exception!.id)
        .orderBy('frame_index', 'asc')
        .execute();

      expect(frames.length).toBeGreaterThan(0);
      expect(frames[0].function_name).toBe('processUser');
      expect(frames[0].file_path).toContain('user.js');
    });

    it('should generate correct fingerprints for grouping', async () => {
      const owner = await createTestUser({ name: 'Owner User' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });
      const project = await createTestProject({ organizationId: org.id, userId: owner.id });

      // Use Python stack trace which works reliably
      const pythonStackTrace = `Traceback (most recent call last):
  File "/app/fingerprint.py", line 10, in <module>
    test_function()
KeyError: Same structure error`;

      const log = await createTestLog({
        projectId: project.id,
        level: 'error',
        message: pythonStackTrace,
        service: 'test-service',
      });

      const job = {
        data: {
          logs: [
            { id: log.id, message: log.message, level: 'error' as const, service: 'test-service' },
          ],
          organizationId: org.id,
          projectId: project.id,
        } as ExceptionParsingJobData,
      } as Job<ExceptionParsingJobData>;

      await processExceptionParsing(job);

      // Get exception and verify fingerprint exists
      const exception = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('log_id', '=', log.id)
        .executeTakeFirst();

      expect(exception).toBeDefined();
      expect(exception?.fingerprint).toBeDefined();
      expect(exception?.fingerprint.length).toBeGreaterThan(0);

      // Verify error group was created with same fingerprint
      const errorGroup = await db
        .selectFrom('error_groups')
        .selectAll()
        .where('fingerprint', '=', exception!.fingerprint)
        .where('organization_id', '=', org.id)
        .executeTakeFirst();

      expect(errorGroup).toBeDefined();
    });
  });
});

describe('Exception Parsing Job Data Types', () => {
  it('should correctly define ExceptionParsingJobData interface', () => {
    const validJobData: ExceptionParsingJobData = {
      logs: [
        {
          id: 'log-123',
          message: 'Error: test',
          level: 'error',
          service: 'test-service',
          metadata: { key: 'value' },
        },
      ],
      organizationId: 'org-123',
      projectId: 'proj-123',
    };

    expect(validJobData.logs).toHaveLength(1);
    expect(validJobData.logs[0].level).toBe('error');
    expect(validJobData.organizationId).toBe('org-123');
    expect(validJobData.projectId).toBe('proj-123');
  });

  it('should accept critical level logs', () => {
    const validJobData: ExceptionParsingJobData = {
      logs: [
        {
          id: 'log-123',
          message: 'Critical: test',
          level: 'critical',
          service: 'test-service',
        },
      ],
      organizationId: 'org-123',
      projectId: 'proj-123',
    };

    expect(validJobData.logs[0].level).toBe('critical');
  });
});
