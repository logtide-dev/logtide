/**
 * Exception Service
 *
 * Handles CRUD operations for exceptions, stack frames, and error groups.
 */

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../../database/types.js';
import { reservoir } from '../../database/reservoir.js';
import type {
  CreateExceptionParams,
  ErrorGroup,
  ErrorGroupFilters,
  ErrorGroupStatus,
  ErrorGroupTrendBucket,
  ExceptionWithFrames,
  ExceptionLanguage,
} from './types.js';

export class ExceptionService {
  constructor(private db: Kysely<Database>) {}

  /**
   * Create exception record with stack frames
   * The trigger will automatically update/create the error group
   */
  async createException(params: CreateExceptionParams): Promise<string> {
    const { organizationId, projectId, logId, parsedData, fingerprint } = params;

    return await this.db.transaction().execute(async (trx) => {
      const exception = await trx
        .insertInto('exceptions')
        .values({
          organization_id: organizationId,
          project_id: projectId,
          log_id: logId,
          exception_type: parsedData.exceptionType,
          exception_message: parsedData.exceptionMessage,
          language: parsedData.language,
          fingerprint,
          raw_stack_trace: parsedData.rawStackTrace,
          frame_count: parsedData.frames.length,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (parsedData.frames.length > 0) {
        await trx
          .insertInto('stack_frames')
          .values(
            parsedData.frames.map((frame) => ({
              exception_id: exception.id,
              frame_index: frame.frameIndex,
              file_path: frame.filePath,
              function_name: frame.functionName || null,
              line_number: frame.lineNumber || null,
              column_number: frame.columnNumber || null,
              is_app_code: frame.isAppCode,
              code_context: frame.codeContext || null,
              metadata: frame.metadata || null,
              original_file: frame.originalFile || null,
              original_line: frame.originalLine || null,
              original_column: frame.originalColumn || null,
              original_function: frame.originalFunction || null,
            }))
          )
          .execute();
      }

      return exception.id;
    });
  }

  /**
   * Get exception with stack frames by log ID
   */
  async getExceptionByLogId(logId: string, organizationId: string): Promise<ExceptionWithFrames | null> {
    const exception = await this.db
      .selectFrom('exceptions')
      .selectAll()
      .where('log_id', '=', logId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!exception) return null;

    const frames = await this.db
      .selectFrom('stack_frames')
      .selectAll()
      .where('exception_id', '=', exception.id)
      .orderBy('frame_index', 'asc')
      .execute();

    return {
      exception: {
        id: exception.id,
        organizationId: exception.organization_id,
        projectId: exception.project_id,
        logId: exception.log_id,
        exceptionType: exception.exception_type,
        exceptionMessage: exception.exception_message,
        language: exception.language as ExceptionLanguage,
        fingerprint: exception.fingerprint,
        rawStackTrace: exception.raw_stack_trace,
        frameCount: exception.frame_count,
        createdAt: exception.created_at,
      },
      frames: frames.map((f) => ({
        id: f.id,
        exceptionId: f.exception_id,
        frameIndex: f.frame_index,
        filePath: f.file_path,
        functionName: f.function_name,
        lineNumber: f.line_number,
        columnNumber: f.column_number,
        isAppCode: f.is_app_code,
        codeContext: f.code_context as Record<string, unknown> | null,
        metadata: f.metadata as Record<string, unknown> | null,
        originalFile: f.original_file,
        originalLine: f.original_line,
        originalColumn: f.original_column,
        originalFunction: f.original_function,
        createdAt: f.created_at,
      })),
    };
  }

  /**
   * Get exception by ID
   */
  async getExceptionById(exceptionId: string, organizationId: string): Promise<ExceptionWithFrames | null> {
    const exception = await this.db
      .selectFrom('exceptions')
      .selectAll()
      .where('id', '=', exceptionId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!exception) return null;

    const frames = await this.db
      .selectFrom('stack_frames')
      .selectAll()
      .where('exception_id', '=', exception.id)
      .orderBy('frame_index', 'asc')
      .execute();

    return {
      exception: {
        id: exception.id,
        organizationId: exception.organization_id,
        projectId: exception.project_id,
        logId: exception.log_id,
        exceptionType: exception.exception_type,
        exceptionMessage: exception.exception_message,
        language: exception.language as ExceptionLanguage,
        fingerprint: exception.fingerprint,
        rawStackTrace: exception.raw_stack_trace,
        frameCount: exception.frame_count,
        createdAt: exception.created_at,
      },
      frames: frames.map((f) => ({
        id: f.id,
        exceptionId: f.exception_id,
        frameIndex: f.frame_index,
        filePath: f.file_path,
        functionName: f.function_name,
        lineNumber: f.line_number,
        columnNumber: f.column_number,
        isAppCode: f.is_app_code,
        codeContext: f.code_context as Record<string, unknown> | null,
        metadata: f.metadata as Record<string, unknown> | null,
        originalFile: f.original_file,
        originalLine: f.original_line,
        originalColumn: f.original_column,
        originalFunction: f.original_function,
        createdAt: f.created_at,
      })),
    };
  }

  /**
   * Check if exception already exists for a log
   */
  async exceptionExists(logId: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('exceptions')
      .select('id')
      .where('log_id', '=', logId)
      .executeTakeFirst();

    return !!result;
  }

  /**
   * Get error groups with filters
   */
  async getErrorGroups(filters: ErrorGroupFilters): Promise<{ groups: ErrorGroup[]; total: number }> {
    let query = this.db
      .selectFrom('error_groups')
      .leftJoin('projects', 'projects.id', 'error_groups.project_id')
      .select([
        'error_groups.id',
        'error_groups.organization_id',
        'error_groups.project_id',
        'projects.name as project_name',
        'error_groups.fingerprint',
        'error_groups.exception_type',
        'error_groups.exception_message',
        'error_groups.language',
        'error_groups.occurrence_count',
        'error_groups.first_seen',
        'error_groups.last_seen',
        'error_groups.status',
        'error_groups.resolved_at',
        'error_groups.resolved_by',
        'error_groups.affected_services',
        'error_groups.sample_log_id',
        'error_groups.created_at',
        'error_groups.updated_at',
      ])
      .where('error_groups.organization_id', '=', filters.organizationId)
      .orderBy('error_groups.last_seen', 'desc');

    if (filters.projectId) {
      query = query.where('error_groups.project_id', '=', filters.projectId);
    }

    if (filters.status) {
      query = query.where('error_groups.status', '=', filters.status);
    }

    if (filters.language) {
      query = query.where('error_groups.language', '=', filters.language);
    }

    if (filters.search) {
      query = query.where((eb) =>
        eb.or([
          eb('error_groups.exception_type', 'ilike', `%${filters.search}%`),
          eb('error_groups.exception_message', 'ilike', `%${filters.search}%`),
        ])
      );
    }

    let countQuery = this.db
      .selectFrom('error_groups')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('organization_id', '=', filters.organizationId);

    if (filters.projectId) {
      countQuery = countQuery.where('project_id', '=', filters.projectId);
    }
    if (filters.status) {
      countQuery = countQuery.where('status', '=', filters.status);
    }
    if (filters.language) {
      countQuery = countQuery.where('language', '=', filters.language);
    }
    if (filters.search) {
      countQuery = countQuery.where((eb) =>
        eb.or([
          eb('exception_type', 'ilike', `%${filters.search}%`),
          eb('exception_message', 'ilike', `%${filters.search}%`),
        ])
      );
    }

    const countResult = await countQuery.executeTakeFirst();
    const total = countResult?.count || 0;

    if (filters.limit) {
      query = query.limit(filters.limit);
    }
    if (filters.offset) {
      query = query.offset(filters.offset);
    }

    const results = await query.execute();

    const groups: ErrorGroup[] = results.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      projectId: r.project_id,
      projectName: r.project_name,
      fingerprint: r.fingerprint,
      exceptionType: r.exception_type,
      exceptionMessage: r.exception_message,
      language: r.language as ExceptionLanguage,
      occurrenceCount: r.occurrence_count,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      status: r.status as ErrorGroupStatus,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
      affectedServices: r.affected_services || [],
      sampleLogId: r.sample_log_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return { groups, total };
  }

  /**
   * Get error group by ID
   */
  async getErrorGroupById(groupId: string): Promise<ErrorGroup | null> {
    const result = await this.db
      .selectFrom('error_groups')
      .leftJoin('projects', 'projects.id', 'error_groups.project_id')
      .select([
        'error_groups.id',
        'error_groups.organization_id',
        'error_groups.project_id',
        'projects.name as project_name',
        'error_groups.fingerprint',
        'error_groups.exception_type',
        'error_groups.exception_message',
        'error_groups.language',
        'error_groups.occurrence_count',
        'error_groups.first_seen',
        'error_groups.last_seen',
        'error_groups.status',
        'error_groups.resolved_at',
        'error_groups.resolved_by',
        'error_groups.affected_services',
        'error_groups.sample_log_id',
        'error_groups.created_at',
        'error_groups.updated_at',
      ])
      .where('error_groups.id', '=', groupId)
      .executeTakeFirst();

    if (!result) return null;

    return {
      id: result.id,
      organizationId: result.organization_id,
      projectId: result.project_id,
      projectName: result.project_name,
      fingerprint: result.fingerprint,
      exceptionType: result.exception_type,
      exceptionMessage: result.exception_message,
      language: result.language as ExceptionLanguage,
      occurrenceCount: result.occurrence_count,
      firstSeen: result.first_seen,
      lastSeen: result.last_seen,
      status: result.status as ErrorGroupStatus,
      resolvedAt: result.resolved_at,
      resolvedBy: result.resolved_by,
      affectedServices: result.affected_services || [],
      sampleLogId: result.sample_log_id,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  /**
   * Update error group status
   */
  async updateErrorGroupStatus(
    groupId: string,
    organizationId: string,
    status: ErrorGroupStatus,
    resolvedBy?: string
  ): Promise<ErrorGroup | null> {
    const result = await this.db
      .updateTable('error_groups')
      .set({
        status,
        resolved_at: status === 'resolved' ? new Date() : null,
        resolved_by: resolvedBy || null,
      })
      .where('id', '=', groupId)
      .where('organization_id', '=', organizationId)
      .returningAll()
      .executeTakeFirst();

    if (!result) return null;

    // Fetch again with project name
    return this.getErrorGroupById(groupId);
  }

  /**
   * Get error group trend (time-series data)
   */
  async getErrorGroupTrend(
    groupId: string,
    interval: '1h' | '1d' = '1d',
    days: number = 7
  ): Promise<ErrorGroupTrendBucket[]> {
    const group = await this.db
      .selectFrom('error_groups')
      .select(['fingerprint', 'organization_id', 'project_id'])
      .where('id', '=', groupId)
      .executeTakeFirst();

    if (!group) return [];

    const intervalStr = interval === '1h' ? '1 hour' : '1 day';
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let query = this.db
      .selectFrom('exceptions')
      .select([
        sql<Date>`time_bucket(${intervalStr}::interval, created_at)`.as('timestamp'),
        sql<number>`count(*)::int`.as('count'),
      ])
      .where('fingerprint', '=', group.fingerprint)
      .where('organization_id', '=', group.organization_id)
      .where('created_at', '>=', startDate);

    if (group.project_id) {
      query = query.where('project_id', '=', group.project_id);
    }

    const results = await query
      .groupBy('timestamp')
      .orderBy('timestamp', 'asc')
      .execute();

    return results.map((r) => ({
      timestamp: r.timestamp,
      count: r.count,
    }));
  }

  /**
   * Get top error groups for dashboard widget
   */
  async getTopErrorGroups(params: {
    organizationId: string;
    projectId?: string;
    limit?: number;
  }): Promise<ErrorGroup[]> {
    let query = this.db
      .selectFrom('error_groups')
      .leftJoin('projects', 'projects.id', 'error_groups.project_id')
      .select([
        'error_groups.id',
        'error_groups.organization_id',
        'error_groups.project_id',
        'projects.name as project_name',
        'error_groups.fingerprint',
        'error_groups.exception_type',
        'error_groups.exception_message',
        'error_groups.language',
        'error_groups.occurrence_count',
        'error_groups.first_seen',
        'error_groups.last_seen',
        'error_groups.status',
        'error_groups.resolved_at',
        'error_groups.resolved_by',
        'error_groups.affected_services',
        'error_groups.sample_log_id',
        'error_groups.created_at',
        'error_groups.updated_at',
      ])
      .where('error_groups.organization_id', '=', params.organizationId)
      .where('error_groups.status', '=', 'open')
      .orderBy('error_groups.occurrence_count', 'desc')
      .limit(params.limit || 5);

    if (params.projectId) {
      query = query.where('error_groups.project_id', '=', params.projectId);
    }

    const results = await query.execute();

    return results.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      projectId: r.project_id,
      projectName: r.project_name,
      fingerprint: r.fingerprint,
      exceptionType: r.exception_type,
      exceptionMessage: r.exception_message,
      language: r.language as ExceptionLanguage,
      occurrenceCount: r.occurrence_count,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      status: r.status as ErrorGroupStatus,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
      affectedServices: r.affected_services || [],
      sampleLogId: r.sample_log_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Get logs for an error group (by fingerprint)
   */
  async getLogsForErrorGroup(params: {
    groupId: string;
    fingerprint: string;
    organizationId: string;
    projectId: string | null;
    firstSeen: Date;
    lastSeen: Date;
    occurrenceCount: number;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: Array<{ id: string; time: Date; service: string; message: string; traceId?: string; metadata?: Record<string, unknown> }>; total: number }> {
    const limit = params.limit || 10;
    const offset = params.offset || 0;

    // Step 1: Get log_ids (with their project_id) from exceptions table (always in PG)
    let query = this.db
      .selectFrom('exceptions')
      .select(['log_id', 'project_id'])
      .where('fingerprint', '=', params.fingerprint)
      .where('organization_id', '=', params.organizationId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (params.projectId) {
      query = query.where('project_id', '=', params.projectId);
    }

    const exceptions = await query.execute();
    const logIds = exceptions.map(e => e.log_id);

    if (logIds.length === 0) {
      return { logs: [], total: params.occurrenceCount };
    }

    // Step 2: Fetch logs via reservoir. getByIds is project-scoped, so we
    // group the requested ids by project and issue one call per project to
    // handle error groups that span projects (project_id is nullable per
    // exception row).
    const idsByProject = new Map<string, string[]>();
    for (const e of exceptions) {
      const pid = e.project_id ?? '';
      if (!pid) continue; // skip rows with no project — nothing to fetch
      const list = idsByProject.get(pid);
      if (list) list.push(e.log_id);
      else idsByProject.set(pid, [e.log_id]);
    }

    const storedLogs = (
      await Promise.all(
        Array.from(idsByProject.entries()).map(([pid, ids]) =>
          reservoir.getByIds({ ids, projectId: pid })
        )
      )
    ).flat();

    // Build lookup map and return in the same order
    const logMap = new Map(storedLogs.map((l: { id: string; time: Date; service: string; message: string; traceId?: string; metadata?: any }) => [l.id, l]));
    const logs = logIds
      .map(id => logMap.get(id))
      .filter((l): l is { id: string; time: Date; service: string; message: string; traceId?: string; metadata?: any } => Boolean(l))
      .map(l => ({
        id: l.id,
        time: l.time,
        service: l.service,
        message: l.message,
        traceId: l.traceId,
        metadata: l.metadata,
      }));

    return {
      logs,
      total: params.occurrenceCount,
    };
  }
}
