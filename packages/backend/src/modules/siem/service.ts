import { Kysely, sql } from 'kysely';
import type { Database } from '../../database/types';
import type {
  DetectionEvent,
  CreateDetectionEventInput,
  Incident,
  CreateIncidentInput,
  UpdateIncidentInput,
  IncidentFilters,
  IncidentComment,
  CreateIncidentCommentInput,
  IncidentHistoryEntry,
} from './types';

export class SiemService {
  constructor(private db: Kysely<Database>) {}

  // ==========================================================================
  // DETECTION EVENTS
  // ==========================================================================

  /**
   * Create a new detection event (called by Sigma detection engine)
   */
  async createDetectionEvent(
    input: CreateDetectionEventInput
  ): Promise<DetectionEvent> {
    const result = await this.db
      .insertInto('detection_events')
      .values({
        organization_id: input.organizationId,
        project_id: input.projectId ?? null,
        sigma_rule_id: input.sigmaRuleId,
        log_id: input.logId,
        severity: input.severity,
        rule_title: input.ruleTitle,
        rule_description: input.ruleDescription ?? null,
        mitre_tactics: input.mitreTactics ?? null,
        mitre_techniques: input.mitreTechniques ?? null,
        service: input.service,
        log_level: input.logLevel,
        log_message: input.logMessage,
        trace_id: input.traceId ?? null,
        matched_fields: input.matchedFields
          ? JSON.stringify(input.matchedFields)
          : null,
        time: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapDetectionEvent(result);
  }

  /**
   * Get detection events for an organization (with filters)
   */
  async getDetectionEvents(filters: {
    organizationId: string;
    projectId?: string | null;
    severity?: string[];
    startTime?: Date;
    endTime?: Date;
    limit?: number;
    offset?: number;
  }): Promise<DetectionEvent[]> {
    let query = this.db
      .selectFrom('detection_events')
      .selectAll()
      .where('organization_id', '=', filters.organizationId);

    if (filters.projectId) {
      query = query.where('project_id', '=', filters.projectId);
    }

    if (filters.severity && filters.severity.length > 0) {
      query = query.where('severity', 'in', filters.severity);
    }

    if (filters.startTime) {
      query = query.where('time', '>=', filters.startTime);
    }

    if (filters.endTime) {
      query = query.where('time', '<=', filters.endTime);
    }

    query = query
      .orderBy('time', 'desc')
      .limit(filters.limit ?? 100)
      .offset(filters.offset ?? 0);

    const results = await query.execute();
    return results.map(this.mapDetectionEvent);
  }

  // ==========================================================================
  // INCIDENTS
  // ==========================================================================

  /**
   * Create a new incident (manually or via auto-grouping)
   */
  async createIncident(input: CreateIncidentInput): Promise<Incident> {
    const result = await this.db
      .insertInto('incidents')
      .values({
        organization_id: input.organizationId,
        project_id: input.projectId ?? null,
        title: input.title,
        description: input.description ?? null,
        severity: input.severity,
        status: input.status ?? 'open',
        assignee_id: input.assigneeId ?? null,
        trace_id: input.traceId ?? null,
        time_window_start: input.timeWindowStart ?? null,
        time_window_end: input.timeWindowEnd ?? null,
        affected_services: input.affectedServices ?? null,
        mitre_tactics: input.mitreTactics ?? null,
        mitre_techniques: input.mitreTechniques ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapIncident(result);
  }

  /**
   * Get incident by ID
   */
  async getIncident(
    incidentId: string,
    organizationId: string
  ): Promise<Incident | null> {
    const result = await this.db
      .selectFrom('incidents')
      .selectAll()
      .where('id', '=', incidentId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return result ? this.mapIncident(result) : null;
  }

  /**
   * List incidents with filters
   */
  async listIncidents(filters: IncidentFilters): Promise<Incident[]> {
    let query = this.db
      .selectFrom('incidents')
      .selectAll()
      .where('organization_id', '=', filters.organizationId);

    if (filters.projectId !== undefined) {
      query = query.where('project_id', '=', filters.projectId);
    }

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        query = query.where('status', 'in', filters.status);
      } else {
        query = query.where('status', '=', filters.status);
      }
    }

    if (filters.severity) {
      if (Array.isArray(filters.severity)) {
        query = query.where('severity', 'in', filters.severity);
      } else {
        query = query.where('severity', '=', filters.severity);
      }
    }

    if (filters.assigneeId !== undefined) {
      query = query.where('assignee_id', '=', filters.assigneeId);
    }

    query = query
      .orderBy('created_at', 'desc')
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0);

    const results = await query.execute();
    return results.map(this.mapIncident);
  }

  /**
   * Update incident
   */
  async updateIncident(
    incidentId: string,
    organizationId: string,
    updates: UpdateIncidentInput
  ): Promise<Incident> {
    const result = await this.db
      .updateTable('incidents')
      .set({
        ...(updates.title && { title: updates.title }),
        ...(updates.description !== undefined && {
          description: updates.description,
        }),
        ...(updates.severity && { severity: updates.severity }),
        ...(updates.status && { status: updates.status }),
        ...(updates.assigneeId !== undefined && {
          assignee_id: updates.assigneeId,
        }),
      })
      .where('id', '=', incidentId)
      .where('organization_id', '=', organizationId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapIncident(result);
  }

  /**
   * Delete incident
   */
  async deleteIncident(
    incidentId: string,
    organizationId: string
  ): Promise<void> {
    await this.db
      .deleteFrom('incidents')
      .where('id', '=', incidentId)
      .where('organization_id', '=', organizationId)
      .execute();
  }

  /**
   * Link detection events to an incident
   */
  async linkDetectionEventsToIncident(
    incidentId: string,
    detectionEventIds: string[]
  ): Promise<void> {
    if (detectionEventIds.length === 0) return;

    // Insert incident_alerts entries
    await this.db
      .insertInto('incident_alerts')
      .values(
        detectionEventIds.map((eventId) => ({
          incident_id: incidentId,
          detection_event_id: eventId,
          alert_history_id: null,
        }))
      )
      .execute();

    // Update detection_events to set incident_id
    await this.db
      .updateTable('detection_events')
      .set({ incident_id: incidentId })
      .where('id', 'in', detectionEventIds)
      .execute();

    // Update incident detection_count
    await this.db
      .updateTable('incidents')
      .set({
        detection_count: sql`detection_count + ${detectionEventIds.length}`,
      })
      .where('id', '=', incidentId)
      .execute();
  }

  /**
   * Get detection events for an incident
   */
  async getIncidentDetections(incidentId: string): Promise<DetectionEvent[]> {
    const results = await this.db
      .selectFrom('detection_events')
      .selectAll()
      .where('incident_id', '=', incidentId)
      .orderBy('time', 'desc')
      .execute();

    return results.map(this.mapDetectionEvent);
  }

  // ==========================================================================
  // INCIDENT COMMENTS
  // ==========================================================================

  /**
   * Add a comment to an incident
   */
  async addComment(
    input: CreateIncidentCommentInput
  ): Promise<IncidentComment> {
    const result = await this.db
      .insertInto('incident_comments')
      .values({
        incident_id: input.incidentId,
        user_id: input.userId,
        comment: input.comment,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapIncidentComment(result);
  }

  /**
   * Get comments for an incident (with user details)
   */
  async getIncidentComments(
    incidentId: string
  ): Promise<IncidentComment[]> {
    const results = await this.db
      .selectFrom('incident_comments')
      .innerJoin('users', 'users.id', 'incident_comments.user_id')
      .select([
        'incident_comments.id',
        'incident_comments.incident_id',
        'incident_comments.user_id',
        'incident_comments.comment',
        'incident_comments.edited',
        'incident_comments.edited_at',
        'incident_comments.created_at',
        'users.name as userName',
        'users.email as userEmail',
      ])
      .where('incident_comments.incident_id', '=', incidentId)
      .orderBy('incident_comments.created_at', 'asc')
      .execute();

    return results.map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      userId: row.user_id,
      comment: row.comment,
      edited: row.edited,
      editedAt: row.edited_at,
      createdAt: row.created_at,
      userName: row.userName,
      userEmail: row.userEmail,
    }));
  }

  // ==========================================================================
  // INCIDENT HISTORY
  // ==========================================================================

  /**
   * Get history for an incident (with user details)
   */
  async getIncidentHistory(
    incidentId: string
  ): Promise<IncidentHistoryEntry[]> {
    const results = await this.db
      .selectFrom('incident_history')
      .innerJoin('users', 'users.id', 'incident_history.user_id')
      .select([
        'incident_history.id',
        'incident_history.incident_id',
        'incident_history.user_id',
        'incident_history.action',
        'incident_history.field_name',
        'incident_history.old_value',
        'incident_history.new_value',
        'incident_history.metadata',
        'incident_history.created_at',
        'users.name as userName',
        'users.email as userEmail',
      ])
      .where('incident_history.incident_id', '=', incidentId)
      .orderBy('incident_history.created_at', 'desc')
      .execute();

    return results.map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      userId: row.user_id,
      action: row.action,
      fieldName: row.field_name,
      oldValue: row.old_value,
      newValue: row.new_value,
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: row.created_at,
      userName: row.userName,
      userEmail: row.userEmail,
    }));
  }

  // ==========================================================================
  // MAPPERS
  // ==========================================================================

  private mapDetectionEvent(row: any): DetectionEvent {
    return {
      id: row.id,
      time: row.time,
      organizationId: row.organization_id,
      projectId: row.project_id,
      sigmaRuleId: row.sigma_rule_id,
      logId: row.log_id,
      severity: row.severity,
      ruleTitle: row.rule_title,
      ruleDescription: row.rule_description,
      mitreTactics: row.mitre_tactics,
      mitreTechniques: row.mitre_techniques,
      service: row.service,
      logLevel: row.log_level,
      logMessage: row.log_message,
      traceId: row.trace_id,
      matchedFields: row.matched_fields,
      incidentId: row.incident_id,
    };
  }

  private mapIncident(row: any): Incident {
    return {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      assigneeId: row.assignee_id,
      traceId: row.trace_id,
      timeWindowStart: row.time_window_start,
      timeWindowEnd: row.time_window_end,
      detectionCount: row.detection_count,
      affectedServices: row.affected_services,
      mitreTactics: row.mitre_tactics,
      mitreTechniques: row.mitre_techniques,
      ipReputation: row.ip_reputation,
      geoData: row.geo_data,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at,
    };
  }

  private mapIncidentComment(row: any): IncidentComment {
    return {
      id: row.id,
      incidentId: row.incident_id,
      userId: row.user_id,
      comment: row.comment,
      edited: row.edited,
      editedAt: row.edited_at,
      createdAt: row.created_at,
    };
  }
}
