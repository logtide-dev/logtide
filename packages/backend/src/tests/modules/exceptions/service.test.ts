import { describe, it, expect, beforeEach } from 'vitest';
import { ExceptionService } from '../../../modules/exceptions/service.js';
import { db } from '../../../database/index.js';
import {
  createTestContext,
  createTestLog,
  createTestOrganization,
  createTestProject,
} from '../../helpers/factories.js';
import type { CreateExceptionParams } from '../../../modules/exceptions/types.js';

describe('ExceptionService', () => {
  const service = new ExceptionService(db);

  describe('createException', () => {
    it('should create exception with stack frames', async () => {
      const ctx = await createTestContext();
      const log = await createTestLog({
        projectId: ctx.project.id,
        level: 'error',
        message: 'Error: Test exception',
      });

      const params: CreateExceptionParams = {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        logId: log.id,
        fingerprint: 'abc123fingerprint',
        parsedData: {
          exceptionType: 'TypeError',
          exceptionMessage: 'Cannot read property x of undefined',
          language: 'nodejs',
          rawStackTrace: 'Error: Test\n    at handler (/app/handler.js:10:5)',
          frames: [
            {
              frameIndex: 0,
              filePath: '/app/src/handler.js',
              functionName: 'handleRequest',
              lineNumber: 42,
              columnNumber: 10,
              isAppCode: true,
            },
            {
              frameIndex: 1,
              filePath: '/app/src/router.js',
              functionName: 'Router.dispatch',
              lineNumber: 100,
              isAppCode: true,
            },
          ],
        },
      };

      const exceptionId = await service.createException(params);

      expect(exceptionId).toBeDefined();
      expect(typeof exceptionId).toBe('string');

      // Verify exception was created
      const exception = await service.getExceptionById(exceptionId);
      expect(exception).not.toBeNull();
      expect(exception!.exception.exceptionType).toBe('TypeError');
      expect(exception!.exception.fingerprint).toBe('abc123fingerprint');
      expect(exception!.frames).toHaveLength(2);
    });

    it('should create exception without frames', async () => {
      const ctx = await createTestContext();
      const log = await createTestLog({
        projectId: ctx.project.id,
        level: 'error',
      });

      const params: CreateExceptionParams = {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        logId: log.id,
        fingerprint: 'noframes123',
        parsedData: {
          exceptionType: 'Error',
          exceptionMessage: 'Simple error',
          language: 'nodejs',
          rawStackTrace: 'Error: Simple error',
          frames: [],
        },
      };

      const exceptionId = await service.createException(params);
      expect(exceptionId).toBeDefined();

      const exception = await service.getExceptionById(exceptionId);
      expect(exception!.frames).toHaveLength(0);
    });
  });

  describe('getExceptionByLogId', () => {
    it('should return exception with frames for valid log', async () => {
      const ctx = await createTestContext();
      const log = await createTestLog({
        projectId: ctx.project.id,
        level: 'error',
      });

      await service.createException({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        logId: log.id,
        fingerprint: 'test-fingerprint',
        parsedData: {
          exceptionType: 'Error',
          exceptionMessage: 'Test',
          language: 'nodejs',
          rawStackTrace: '',
          frames: [
            {
              frameIndex: 0,
              filePath: '/app/test.js',
              functionName: 'test',
              lineNumber: 1,
              isAppCode: true,
            },
          ],
        },
      });

      const result = await service.getExceptionByLogId(log.id);

      expect(result).not.toBeNull();
      expect(result!.exception.logId).toBe(log.id);
      expect(result!.frames).toHaveLength(1);
    });

    it('should return null for non-existent log', async () => {
      const result = await service.getExceptionByLogId('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('getExceptionById', () => {
    it('should return exception with frames', async () => {
      const ctx = await createTestContext();
      const log = await createTestLog({ projectId: ctx.project.id });

      const exceptionId = await service.createException({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        logId: log.id,
        fingerprint: 'byid-test',
        parsedData: {
          exceptionType: 'ReferenceError',
          exceptionMessage: 'x is not defined',
          language: 'nodejs',
          rawStackTrace: '',
          frames: [
            {
              frameIndex: 0,
              filePath: '/app/script.js',
              functionName: 'evaluate',
              lineNumber: 15,
              isAppCode: true,
            },
          ],
        },
      });

      const result = await service.getExceptionById(exceptionId);

      expect(result).not.toBeNull();
      expect(result!.exception.id).toBe(exceptionId);
      expect(result!.exception.exceptionType).toBe('ReferenceError');
    });

    it('should return null for non-existent exception', async () => {
      const result = await service.getExceptionById('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('exceptionExists', () => {
    it('should return true when exception exists for log', async () => {
      const ctx = await createTestContext();
      const log = await createTestLog({ projectId: ctx.project.id });

      await service.createException({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        logId: log.id,
        fingerprint: 'exists-test',
        parsedData: {
          exceptionType: 'Error',
          exceptionMessage: 'Test',
          language: 'nodejs',
          rawStackTrace: '',
          frames: [],
        },
      });

      const exists = await service.exceptionExists(log.id);
      expect(exists).toBe(true);
    });

    it('should return false when no exception for log', async () => {
      const ctx = await createTestContext();
      const log = await createTestLog({ projectId: ctx.project.id });

      const exists = await service.exceptionExists(log.id);
      expect(exists).toBe(false);
    });
  });

  describe('getErrorGroups', () => {
    it('should return error groups for organization', async () => {
      const ctx = await createTestContext();

      // Create an error group by inserting directly
      await db
        .insertInto('error_groups')
        .values({
          organization_id: ctx.organization.id,
          project_id: ctx.project.id,
          fingerprint: 'test-fp-1',
          exception_type: 'TypeError',
          exception_message: 'Test error',
          language: 'nodejs',
          occurrence_count: 5,
          first_seen: new Date(),
          last_seen: new Date(),
          status: 'open',
          sample_log_id: null,
        })
        .execute();

      const result = await service.getErrorGroups({
        organizationId: ctx.organization.id,
      });

      expect(result.groups.length).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeGreaterThanOrEqual(1);
    });

    it('should filter by project', async () => {
      const ctx = await createTestContext();
      const project2 = await createTestProject({ organizationId: ctx.organization.id });

      await db
        .insertInto('error_groups')
        .values([
          {
            organization_id: ctx.organization.id,
            project_id: ctx.project.id,
            fingerprint: 'project1-fp',
            exception_type: 'Error',
            exception_message: 'Project 1 error',
            language: 'nodejs',
            occurrence_count: 1,
            first_seen: new Date(),
            last_seen: new Date(),
            status: 'open',
            sample_log_id: null,
          },
          {
            organization_id: ctx.organization.id,
            project_id: project2.id,
            fingerprint: 'project2-fp',
            exception_type: 'Error',
            exception_message: 'Project 2 error',
            language: 'nodejs',
            occurrence_count: 1,
            first_seen: new Date(),
            last_seen: new Date(),
            status: 'open',
            sample_log_id: null,
          },
        ])
        .execute();

      const result = await service.getErrorGroups({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
      });

      expect(result.groups.every((g) => g.projectId === ctx.project.id)).toBe(true);
    });

    it('should filter by status', async () => {
      const ctx = await createTestContext();

      await db
        .insertInto('error_groups')
        .values([
          {
            organization_id: ctx.organization.id,
            project_id: ctx.project.id,
            fingerprint: 'open-fp',
            exception_type: 'Error',
            exception_message: 'Open error',
            language: 'nodejs',
            occurrence_count: 1,
            first_seen: new Date(),
            last_seen: new Date(),
            status: 'open',
            sample_log_id: null,
          },
          {
            organization_id: ctx.organization.id,
            project_id: ctx.project.id,
            fingerprint: 'resolved-fp',
            exception_type: 'Error',
            exception_message: 'Resolved error',
            language: 'nodejs',
            occurrence_count: 1,
            first_seen: new Date(),
            last_seen: new Date(),
            status: 'resolved',
            sample_log_id: null,
          },
        ])
        .execute();

      const result = await service.getErrorGroups({
        organizationId: ctx.organization.id,
        status: 'resolved',
      });

      expect(result.groups.every((g) => g.status === 'resolved')).toBe(true);
    });

    it('should filter by language', async () => {
      const ctx = await createTestContext();

      await db
        .insertInto('error_groups')
        .values([
          {
            organization_id: ctx.organization.id,
            project_id: ctx.project.id,
            fingerprint: 'nodejs-fp-lang',
            exception_type: 'Error',
            exception_message: 'Node error',
            language: 'nodejs',
            occurrence_count: 1,
            first_seen: new Date(),
            last_seen: new Date(),
            status: 'open',
            sample_log_id: null,
          },
          {
            organization_id: ctx.organization.id,
            project_id: ctx.project.id,
            fingerprint: 'python-fp-lang',
            exception_type: 'Error',
            exception_message: 'Python error',
            language: 'python',
            occurrence_count: 1,
            first_seen: new Date(),
            last_seen: new Date(),
            status: 'open',
            sample_log_id: null,
          },
        ])
        .execute();

      const result = await service.getErrorGroups({
        organizationId: ctx.organization.id,
        language: 'python',
      });

      expect(result.groups.every((g) => g.language === 'python')).toBe(true);
    });

    it('should filter by search term', async () => {
      const ctx = await createTestContext();

      await db
        .insertInto('error_groups')
        .values([
          {
            organization_id: ctx.organization.id,
            project_id: ctx.project.id,
            fingerprint: 'search1-fp',
            exception_type: 'DatabaseError',
            exception_message: 'Connection refused to database',
            language: 'nodejs',
            occurrence_count: 1,
            first_seen: new Date(),
            last_seen: new Date(),
            status: 'open',
            sample_log_id: null,
          },
          {
            organization_id: ctx.organization.id,
            project_id: ctx.project.id,
            fingerprint: 'search2-fp',
            exception_type: 'ValidationError',
            exception_message: 'Invalid input',
            language: 'nodejs',
            occurrence_count: 1,
            first_seen: new Date(),
            last_seen: new Date(),
            status: 'open',
            sample_log_id: null,
          },
        ])
        .execute();

      const result = await service.getErrorGroups({
        organizationId: ctx.organization.id,
        search: 'Database',
      });

      expect(result.groups.some((g) =>
        g.exceptionType.includes('Database') || g.exceptionMessage.includes('database')
      )).toBe(true);
    });

    it('should support pagination', async () => {
      const ctx = await createTestContext();

      // Create multiple error groups
      const groups = Array.from({ length: 10 }, (_, i) => ({
        organization_id: ctx.organization.id,
        project_id: ctx.project.id,
        fingerprint: `paginate-fp-${i}`,
        exception_type: 'Error',
        exception_message: `Error ${i}`,
        language: 'nodejs' as const,
        occurrence_count: 1,
        first_seen: new Date(),
        last_seen: new Date(Date.now() - i * 1000), // Different last_seen for ordering
        status: 'open' as const,
        sample_log_id: null,
      }));

      await db.insertInto('error_groups').values(groups).execute();

      const page1 = await service.getErrorGroups({
        organizationId: ctx.organization.id,
        limit: 5,
        offset: 0,
      });

      const page2 = await service.getErrorGroups({
        organizationId: ctx.organization.id,
        limit: 5,
        offset: 5,
      });

      expect(page1.groups.length).toBe(5);
      expect(page2.groups.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getErrorGroupById', () => {
    it('should return error group by ID', async () => {
      const ctx = await createTestContext();

      const inserted = await db
        .insertInto('error_groups')
        .values({
          organization_id: ctx.organization.id,
          project_id: ctx.project.id,
          fingerprint: 'byid-test-fp',
          exception_type: 'CustomError',
          exception_message: 'Custom message',
          language: 'nodejs',
          occurrence_count: 3,
          first_seen: new Date(),
          last_seen: new Date(),
          status: 'open',
          sample_log_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const result = await service.getErrorGroupById(inserted.id);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(inserted.id);
      expect(result!.exceptionType).toBe('CustomError');
    });

    it('should return null for non-existent group', async () => {
      const result = await service.getErrorGroupById('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('updateErrorGroupStatus', () => {
    it('should update status to resolved', async () => {
      const ctx = await createTestContext();

      const inserted = await db
        .insertInto('error_groups')
        .values({
          organization_id: ctx.organization.id,
          project_id: ctx.project.id,
          fingerprint: 'status-test-fp',
          exception_type: 'Error',
          exception_message: 'Test',
          language: 'nodejs',
          occurrence_count: 1,
          first_seen: new Date(),
          last_seen: new Date(),
          status: 'open',
          sample_log_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const result = await service.updateErrorGroupStatus(inserted.id, 'resolved', ctx.user.id);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('resolved');
      expect(result!.resolvedAt).not.toBeNull();
      expect(result!.resolvedBy).toBe(ctx.user.id);
    });

    it('should update status to ignored', async () => {
      const ctx = await createTestContext();

      const inserted = await db
        .insertInto('error_groups')
        .values({
          organization_id: ctx.organization.id,
          project_id: ctx.project.id,
          fingerprint: 'ignore-test-fp',
          exception_type: 'Error',
          exception_message: 'Ignorable',
          language: 'nodejs',
          occurrence_count: 1,
          first_seen: new Date(),
          last_seen: new Date(),
          status: 'open',
          sample_log_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const result = await service.updateErrorGroupStatus(inserted.id, 'ignored');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('ignored');
    });

    it('should reopen resolved group', async () => {
      const ctx = await createTestContext();

      const inserted = await db
        .insertInto('error_groups')
        .values({
          organization_id: ctx.organization.id,
          project_id: ctx.project.id,
          fingerprint: 'reopen-test-fp',
          exception_type: 'Error',
          exception_message: 'Test',
          language: 'nodejs',
          occurrence_count: 1,
          first_seen: new Date(),
          last_seen: new Date(),
          status: 'resolved',
          resolved_at: new Date(),
          resolved_by: ctx.user.id,
          sample_log_id: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const result = await service.updateErrorGroupStatus(inserted.id, 'open');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('open');
      expect(result!.resolvedAt).toBeNull();
    });

    it('should return null for non-existent group', async () => {
      const result = await service.updateErrorGroupStatus(
        '00000000-0000-0000-0000-000000000000',
        'resolved'
      );
      expect(result).toBeNull();
    });
  });

  describe('getTopErrorGroups', () => {
    it('should return top error groups by occurrence count', async () => {
      const ctx = await createTestContext();

      await db
        .insertInto('error_groups')
        .values([
          {
            organization_id: ctx.organization.id,
            project_id: ctx.project.id,
            fingerprint: 'top1-fp',
            exception_type: 'Error',
            exception_message: 'High count',
            language: 'nodejs',
            occurrence_count: 100,
            first_seen: new Date(),
            last_seen: new Date(),
            status: 'open',
            sample_log_id: null,
          },
          {
            organization_id: ctx.organization.id,
            project_id: ctx.project.id,
            fingerprint: 'top2-fp',
            exception_type: 'Error',
            exception_message: 'Medium count',
            language: 'nodejs',
            occurrence_count: 50,
            first_seen: new Date(),
            last_seen: new Date(),
            status: 'open',
            sample_log_id: null,
          },
          {
            organization_id: ctx.organization.id,
            project_id: ctx.project.id,
            fingerprint: 'top3-fp',
            exception_type: 'Error',
            exception_message: 'Low count',
            language: 'nodejs',
            occurrence_count: 10,
            first_seen: new Date(),
            last_seen: new Date(),
            status: 'open',
            sample_log_id: null,
          },
        ])
        .execute();

      const result = await service.getTopErrorGroups({
        organizationId: ctx.organization.id,
        limit: 3,
      });

      expect(result.length).toBeGreaterThanOrEqual(1);
      // Should be ordered by occurrence_count desc
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].occurrenceCount).toBeGreaterThanOrEqual(result[i].occurrenceCount);
      }
    });

    it('should only return open groups', async () => {
      const ctx = await createTestContext();

      await db
        .insertInto('error_groups')
        .values([
          {
            organization_id: ctx.organization.id,
            project_id: ctx.project.id,
            fingerprint: 'open-top-fp',
            exception_type: 'Error',
            exception_message: 'Open',
            language: 'nodejs',
            occurrence_count: 100,
            first_seen: new Date(),
            last_seen: new Date(),
            status: 'open',
            sample_log_id: null,
          },
          {
            organization_id: ctx.organization.id,
            project_id: ctx.project.id,
            fingerprint: 'resolved-top-fp',
            exception_type: 'Error',
            exception_message: 'Resolved',
            language: 'nodejs',
            occurrence_count: 200,
            first_seen: new Date(),
            last_seen: new Date(),
            status: 'resolved',
            sample_log_id: null,
          },
        ])
        .execute();

      const result = await service.getTopErrorGroups({
        organizationId: ctx.organization.id,
      });

      expect(result.every((g) => g.status === 'open')).toBe(true);
    });
  });

  describe('getErrorGroupTrend', () => {
    it('should return empty array for non-existent group', async () => {
      const result = await service.getErrorGroupTrend('00000000-0000-0000-0000-000000000000');
      expect(result).toEqual([]);
    });
  });

  describe('getLogsForErrorGroup', () => {
    it('should return empty when group not found', async () => {
      const result = await service.getLogsForErrorGroup({
        groupId: '00000000-0000-0000-0000-000000000000',
      });

      expect(result.logs).toEqual([]);
      expect(result.total).toBe(0);
    });
  });
});
