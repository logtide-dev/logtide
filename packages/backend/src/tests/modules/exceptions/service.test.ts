import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
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
      const exception = await service.getExceptionById(exceptionId, ctx.organization.id);
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

      const exception = await service.getExceptionById(exceptionId, ctx.organization.id);
      expect(exception!.frames).toHaveLength(0);
    });
  });

  describe('error group service attribution', () => {
    const parsedData = {
      exceptionType: 'TypeError',
      exceptionMessage: "Cannot read properties of undefined (reading 'x')",
      language: 'nodejs' as const,
      rawStackTrace: 'TypeError: x\n    at h (/app/h.js:1:1)',
      frames: [],
    };

    async function affectedServices(orgId: string, fingerprint: string): Promise<string[]> {
      const group = await db
        .selectFrom('error_groups')
        .select('affected_services')
        .where('organization_id', '=', orgId)
        .where('fingerprint', '=', fingerprint)
        .executeTakeFirst();
      return (group?.affected_services as string[] | undefined) ?? [];
    }

    it('attributes the service carried on the exception, not the Postgres logs lookup', async () => {
      // Simulate a non-TimescaleDB reservoir (ClickHouse / MongoDB): the log is
      // NOT in the Postgres logs table, so the trigger's logs lookup finds
      // nothing. The service must still come through from the exception row.
      const ctx = await createTestContext();
      const fingerprint = `svc-carry-${randomUUID().slice(0, 8)}`;

      await service.createException({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        logId: randomUUID(), // no matching row in `logs`
        fingerprint,
        service: 'checkout-api',
        parsedData,
      });

      expect(await affectedServices(ctx.organization.id, fingerprint)).toEqual(['checkout-api']);
    });

    it('falls back to the logs table when no service is carried (TimescaleDB path)', async () => {
      const ctx = await createTestContext();
      const log = await createTestLog({
        projectId: ctx.project.id,
        level: 'error',
        service: 'billing-worker',
      });
      const fingerprint = `svc-fallback-${randomUUID().slice(0, 8)}`;

      await service.createException({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        logId: log.id,
        fingerprint,
        parsedData,
      });

      expect(await affectedServices(ctx.organization.id, fingerprint)).toEqual(['billing-worker']);
    });

    it('never leaves a group as unknown when the service is known at ingestion', async () => {
      const ctx = await createTestContext();
      const fingerprint = `svc-known-${randomUUID().slice(0, 8)}`;

      await service.createException({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        logId: randomUUID(),
        fingerprint,
        service: 'api',
        parsedData,
      });

      expect(await affectedServices(ctx.organization.id, fingerprint)).not.toContain('unknown');
    });
  });

  describe('mergeErrorGroups', () => {
    const parsed = {
      exceptionType: 'TypeError',
      exceptionMessage: "Cannot read properties of undefined (reading 'x')",
      language: 'nodejs' as const,
      rawStackTrace: 'TypeError: x\n    at h (/app/h.js:1:1)',
      frames: [],
    };

    it('folds duplicate groups into one and reassigns their exceptions', async () => {
      const ctx = await createTestContext();
      const fpTarget = `merge-target-${randomUUID().slice(0, 8)}`;
      const fpSource = `merge-source-${randomUUID().slice(0, 8)}`;

      // Target: 1 occurrence on service "api"
      await service.createException({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        logId: randomUUID(),
        fingerprint: fpTarget,
        service: 'api',
        parsedData: parsed,
      });
      // Source: 2 occurrences on service "worker", same type+message, different fingerprint
      for (let i = 0; i < 2; i++) {
        await service.createException({
          organizationId: ctx.organization.id,
          projectId: ctx.project.id,
          logId: randomUUID(),
          fingerprint: fpSource,
          service: 'worker',
          parsedData: parsed,
        });
      }

      const groups = await db
        .selectFrom('error_groups')
        .select(['id', 'fingerprint'])
        .where('organization_id', '=', ctx.organization.id)
        .execute();
      const target = groups.find((g) => g.fingerprint === fpTarget)!;
      const source = groups.find((g) => g.fingerprint === fpSource)!;

      // Same type+message groups surface as duplicates of each other.
      const dups = await service.findDuplicateErrorGroups(target.id, ctx.organization.id);
      expect(dups.map((d) => d.id)).toContain(source.id);

      const merged = await service.mergeErrorGroups(target.id, [source.id], ctx.organization.id);
      expect(merged).not.toBeNull();
      expect(merged!.occurrenceCount).toBe(3); // 1 + 2
      expect([...merged!.affectedServices].sort()).toEqual(['api', 'worker']);

      // Source group is gone
      const remaining = await db
        .selectFrom('error_groups')
        .select('id')
        .where('id', '=', source.id)
        .executeTakeFirst();
      expect(remaining).toBeUndefined();

      // Its exceptions now point at the target fingerprint
      const stillSource = await db
        .selectFrom('exceptions')
        .select('id')
        .where('organization_id', '=', ctx.organization.id)
        .where('fingerprint', '=', fpSource)
        .execute();
      expect(stillSource.length).toBe(0);
    });

    it('does not merge groups from another organization', async () => {
      const ctx = await createTestContext();
      const other = await createTestContext();
      const fpTarget = `merge-iso-t-${randomUUID().slice(0, 8)}`;
      const fpOther = `merge-iso-o-${randomUUID().slice(0, 8)}`;

      await service.createException({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        logId: randomUUID(),
        fingerprint: fpTarget,
        service: 'api',
        parsedData: parsed,
      });
      await service.createException({
        organizationId: other.organization.id,
        projectId: other.project.id,
        logId: randomUUID(),
        fingerprint: fpOther,
        service: 'api',
        parsedData: parsed,
      });

      const target = await db
        .selectFrom('error_groups')
        .select(['id'])
        .where('organization_id', '=', ctx.organization.id)
        .where('fingerprint', '=', fpTarget)
        .executeTakeFirstOrThrow();
      const otherGroup = await db
        .selectFrom('error_groups')
        .select(['id'])
        .where('organization_id', '=', other.organization.id)
        .where('fingerprint', '=', fpOther)
        .executeTakeFirstOrThrow();

      // Attempting to merge another org's group is a no-op; it stays put.
      const merged = await service.mergeErrorGroups(target.id, [otherGroup.id], ctx.organization.id);
      expect(merged!.occurrenceCount).toBe(1);
      const survives = await db
        .selectFrom('error_groups')
        .select('id')
        .where('id', '=', otherGroup.id)
        .executeTakeFirst();
      expect(survives).not.toBeUndefined();
    });

    it('does not surface duplicates from another project in the same org', async () => {
      const ctx = await createTestContext();
      const project2 = await createTestProject({ organizationId: ctx.organization.id });
      const fpTarget = `dup-proj-t-${randomUUID().slice(0, 8)}`;
      const fpOther = `dup-proj-o-${randomUUID().slice(0, 8)}`;

      // Same type+message in two projects of the same org.
      await service.createException({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        logId: randomUUID(),
        fingerprint: fpTarget,
        service: 'api',
        parsedData: parsed,
      });
      await service.createException({
        organizationId: ctx.organization.id,
        projectId: project2.id,
        logId: randomUUID(),
        fingerprint: fpOther,
        service: 'api',
        parsedData: parsed,
      });

      const target = await db
        .selectFrom('error_groups')
        .select(['id'])
        .where('organization_id', '=', ctx.organization.id)
        .where('fingerprint', '=', fpTarget)
        .executeTakeFirstOrThrow();
      const otherGroup = await db
        .selectFrom('error_groups')
        .select(['id'])
        .where('organization_id', '=', ctx.organization.id)
        .where('fingerprint', '=', fpOther)
        .executeTakeFirstOrThrow();

      const dups = await service.findDuplicateErrorGroups(target.id, ctx.organization.id);
      expect(dups.map((d) => d.id)).not.toContain(otherGroup.id);
    });

    it('does not merge or retag a sibling project sharing the same fingerprint', async () => {
      const ctx = await createTestContext();
      const project2 = await createTestProject({ organizationId: ctx.organization.id });
      const fpTarget = `merge-proj-t-${randomUUID().slice(0, 8)}`;
      // Deliberately identical fingerprint string across two projects.
      const fpShared = `merge-proj-shared-${randomUUID().slice(0, 8)}`;

      await service.createException({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        logId: randomUUID(),
        fingerprint: fpTarget,
        service: 'api',
        parsedData: parsed,
      });
      // Source in the target's project (legitimate merge candidate).
      await service.createException({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        logId: randomUUID(),
        fingerprint: fpShared,
        service: 'api',
        parsedData: parsed,
      });
      // Same fingerprint string, different project: must be untouched.
      await service.createException({
        organizationId: ctx.organization.id,
        projectId: project2.id,
        logId: randomUUID(),
        fingerprint: fpShared,
        service: 'api',
        parsedData: parsed,
      });

      const target = await db
        .selectFrom('error_groups')
        .select(['id'])
        .where('organization_id', '=', ctx.organization.id)
        .where('project_id', '=', ctx.project.id)
        .where('fingerprint', '=', fpTarget)
        .executeTakeFirstOrThrow();
      const sameProjectSource = await db
        .selectFrom('error_groups')
        .select(['id'])
        .where('organization_id', '=', ctx.organization.id)
        .where('project_id', '=', ctx.project.id)
        .where('fingerprint', '=', fpShared)
        .executeTakeFirstOrThrow();
      const siblingGroup = await db
        .selectFrom('error_groups')
        .select(['id'])
        .where('organization_id', '=', ctx.organization.id)
        .where('project_id', '=', project2.id)
        .where('fingerprint', '=', fpShared)
        .executeTakeFirstOrThrow();

      // Merging the same-project source folds it in; the sibling project's group
      // with the identical fingerprint stays put and its exceptions keep their
      // fingerprint.
      await service.mergeErrorGroups(target.id, [sameProjectSource.id], ctx.organization.id);

      const siblingSurvives = await db
        .selectFrom('error_groups')
        .select('id')
        .where('id', '=', siblingGroup.id)
        .executeTakeFirst();
      expect(siblingSurvives).not.toBeUndefined();

      const siblingExceptions = await db
        .selectFrom('exceptions')
        .select('id')
        .where('organization_id', '=', ctx.organization.id)
        .where('project_id', '=', project2.id)
        .where('fingerprint', '=', fpShared)
        .execute();
      expect(siblingExceptions.length).toBe(1);
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

      const result = await service.getExceptionByLogId(log.id, ctx.organization.id);

      expect(result).not.toBeNull();
      expect(result!.exception.logId).toBe(log.id);
      expect(result!.frames).toHaveLength(1);
    });

    it('should return null for non-existent log', async () => {
      const ctx = await createTestContext();
      const result = await service.getExceptionByLogId('00000000-0000-0000-0000-000000000000', ctx.organization.id);
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

      const result = await service.getExceptionById(exceptionId, ctx.organization.id);

      expect(result).not.toBeNull();
      expect(result!.exception.id).toBe(exceptionId);
      expect(result!.exception.exceptionType).toBe('ReferenceError');
    });

    it('should return null for non-existent exception', async () => {
      const ctx = await createTestContext();
      const result = await service.getExceptionById('00000000-0000-0000-0000-000000000000', ctx.organization.id);
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

      const result = await service.updateErrorGroupStatus(inserted.id, ctx.organization.id, 'resolved', ctx.user.id);

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

      const result = await service.updateErrorGroupStatus(inserted.id, ctx.organization.id, 'ignored');

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

      const result = await service.updateErrorGroupStatus(inserted.id, ctx.organization.id, 'open');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('open');
      expect(result!.resolvedAt).toBeNull();
    });

    it('should return null for non-existent group', async () => {
      const ctx = await createTestContext();
      const result = await service.updateErrorGroupStatus(
        '00000000-0000-0000-0000-000000000000',
        ctx.organization.id,
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
    it('should return empty when no matching logs', async () => {
      const ctx = await createTestContext();
      const result = await service.getLogsForErrorGroup({
        groupId: '00000000-0000-0000-0000-000000000000',
        fingerprint: 'nonexistent',
        organizationId: ctx.organization.id,
        projectId: null,
        firstSeen: new Date('2020-01-01'),
        lastSeen: new Date('2020-01-02'),
        occurrenceCount: 0,
      });

      expect(result.logs).toEqual([]);
      expect(result.total).toBe(0);
    });
  });
});
