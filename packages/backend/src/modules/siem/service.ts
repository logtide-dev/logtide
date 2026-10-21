import { Kysely, sql, Expression, SqlBool } from 'kysely';
import type { Database, Severity } from '../../database/types';
import type { PackCategory } from '@logtide/shared';
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
  IpReputationData,
  GeoIpData,
} from './types';
import { incidentNotificationQueue } from '../../queue/jobs/incident-notification.js';
import type { EnrichmentService } from './enrichment-service.js';
import { mapIncidentRow } from '../incidents/mappers.js';

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
        matched_fields: input.matchedFields ?? null,
        category: input.category ?? 'security',
        time: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapDetectionEvent(result);
  }

  /**
   * Get detection events for an organization (with filters)
   *
   * PERFORMANCE: Uses default 7-day time filter to avoid full table scan.
   * Selects specific columns instead of selectAll() for better performance.
   */
  async getDetectionEvents(filters: {
    organizationId: string;
    projectId?: string | null;
    severity?: string[];
    category?: string | string[];
    startTime?: Date;
    endTime?: Date;
    limit?: number;
    offset?: number;
  }): Promise<DetectionEvent[]> {
    // Default to last 7 days to avoid full table scan
    const effectiveStartTime = filters.startTime || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    let query = this.db
      .selectFrom('detection_events')
      .select([
        'id',
        'time',
        'organization_id',
        'project_id',
        'sigma_rule_id',
        'log_id',
        'severity',
        'rule_title',
        'rule_description',
        'mitre_tactics',
        'mitre_techniques',
        'service',
        'log_level',
        'log_message',
        'trace_id',
        'matched_fields',
        'incident_id',
        'category',
      ])
      .where('organization_id', '=', filters.organizationId)
      .where('time', '>=', effectiveStartTime);

    if (filters.category) {
      if (Array.isArray(filters.category)) {
        query = query.where('category', 'in', filters.category as PackCategory[]);
      } else {
        query = query.where('category', '=', filters.category as PackCategory);
      }
    }

    if (filters.projectId) {
      query = query.where('project_id', '=', filters.projectId);
    }

    if (filters.severity && filters.severity.length > 0) {
      query = query.where('severity', 'in', filters.severity as Severity[]);
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
        source: input.source ?? 'sigma',
        monitor_id: input.monitorId ?? null,
        ...(input.timeWindowEnd && { last_event_at: input.timeWindowEnd }),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const incident = this.mapIncident(result);

    // Queue notification for new incident (async, don't wait)
    incidentNotificationQueue.add('new-incident', {
      incidentId: incident.id,
      organizationId: incident.organizationId,
      title: incident.title,
      description: incident.description,
      severity: incident.severity,
      affectedServices: incident.affectedServices,
    }).catch((err) => {
      console.error('[SiemService] Failed to queue incident notification:', err);
    });

    return incident;
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
  async listIncidents(filters: IncidentFilters): Promise<{ incidents: Incident[]; total: number }> {
    let baseQuery = this.db
      .selectFrom('incidents')
      .where('organization_id', '=', filters.organizationId);

    if (filters.projectId !== undefined) {
      baseQuery = baseQuery.where('project_id', '=', filters.projectId);
    }

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        baseQuery = baseQuery.where('status', 'in', filters.status);
      } else {
        baseQuery = baseQuery.where('status', '=', filters.status);
      }
    }

    if (filters.severity) {
      if (Array.isArray(filters.severity)) {
        baseQuery = baseQuery.where('severity', 'in', filters.severity);
      } else {
        baseQuery = baseQuery.where('severity', '=', filters.severity);
      }
    }

    if (filters.assigneeId !== undefined) {
      baseQuery = baseQuery.where('assignee_id', '=', filters.assigneeId);
    }

    // Filter by service (check if service is in affected_services array)
    if (filters.service) {
      baseQuery = baseQuery.where(
        sql<boolean>`${filters.service} = ANY(affected_services)` as Expression<SqlBool>
      );
    }

    // Filter by MITRE technique (check if technique is in mitre_techniques array)
    if (filters.technique) {
      baseQuery = baseQuery.where(
        sql<boolean>`${filters.technique} = ANY(mitre_techniques)` as Expression<SqlBool>
      );
    }

    // Run data query and count query in parallel
    const [results, countResult] = await Promise.all([
      baseQuery
        .selectAll()
        .orderBy('created_at', 'desc')
        .limit(filters.limit ?? 50)
        .offset(filters.offset ?? 0)
        .execute(),
      baseQuery
        .select(sql<number>`count(*)::int`.as('count'))
        .executeTakeFirstOrThrow(),
    ]);

    return {
      incidents: results.map(this.mapIncident),
      total: countResult.count,
    };
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
        ...(updates.title !== undefined && { title: updates.title }),
        ...(updates.description !== undefined && {
          description: updates.description,
        }),
        ...(updates.severity !== undefined && { severity: updates.severity }),
        ...(updates.status !== undefined && { status: updates.status }),
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
    detectionEventIds: string[],
    organizationId: string
  ): Promise<void> {
    if (detectionEventIds.length === 0) return;

    // Only link detection events that actually belong to this organization.
    // Otherwise the incident_alerts insert would link cross-tenant events and the
    // detection_count would be inflated by events that were never updated.
    const owned = await this.db
      .selectFrom('detection_events')
      .select('id')
      .where('id', 'in', detectionEventIds)
      .where('organization_id', '=', organizationId)
      .execute();
    const ownedIds = owned.map((r) => r.id);
    if (ownedIds.length === 0) return;

    // Insert incident_alerts entries
    await this.db
      .insertInto('incident_alerts')
      .values(
        ownedIds.map((eventId) => ({
          incident_id: incidentId,
          detection_event_id: eventId,
          alert_history_id: null,
        }))
      )
      .execute();

    // Update detection_events to set incident_id (always scoped to org)
    await this.db
      .updateTable('detection_events')
      .set({ incident_id: incidentId })
      .where('id', 'in', ownedIds)
      .where('organization_id', '=', organizationId)
      .execute();

    // Update incident detection_count (scoped to org)
    await this.db
      .updateTable('incidents')
      .set({
        detection_count: sql`detection_count + ${ownedIds.length}`,
      })
      .where('id', '=', incidentId)
      .where('organization_id', '=', organizationId)
      .execute();
  }

  /**
   * Get detection events for an incident
   */
  async getIncidentDetections(incidentId: string, organizationId: string): Promise<DetectionEvent[]> {
    const results = await this.db
      .selectFrom('detection_events')
      .selectAll()
      .where('incident_id', '=', incidentId)
      .where('organization_id', '=', organizationId)
      .orderBy('time', 'desc')
      .execute();

    return results.map(this.mapDetectionEvent);
  }

  /**
   * Enrich incident with IP reputation and GeoIP data from linked detection events.
   * Extracts all public IPs from detection events and performs batch enrichment.
   * Gracefully handles errors - enrichment failure does not affect incident.
   */
  async enrichIncidentIpData(
    incidentId: string,
    enrichmentService: EnrichmentService,
    organizationId: string
  ): Promise<void> {
    try {
      console.log(`[SiemService] Enriching incident ${incidentId} with IP data`);

      // 1. Get all detection events for this incident
      const detections = await this.getIncidentDetections(incidentId, organizationId);

      if (detections.length === 0) {
        console.log(`[SiemService] No detection events found for incident ${incidentId}`);
        return;
      }

      // 2. Extract all IPs from log messages and matched fields
      const allIps = new Set<string>();

      for (const detection of detections) {
        // Extract from log message
        const ipsFromMessage = enrichmentService.extractIpAddresses(detection.logMessage);
        ipsFromMessage.forEach((ip) => allIps.add(ip));

        // Extract from matched fields (JSONB object)
        if (detection.matchedFields) {
          const matchedFieldsStr = JSON.stringify(detection.matchedFields);
          const ipsFromFields = enrichmentService.extractIpAddresses(matchedFieldsStr);
          ipsFromFields.forEach((ip) => allIps.add(ip));
        }
      }

      const uniqueIps = Array.from(allIps);

      if (uniqueIps.length === 0) {
        console.log(`[SiemService] No IPs found in detection events for incident ${incidentId}`);
        return;
      }

      console.log(`[SiemService] Found ${uniqueIps.length} unique IPs to enrich`);

      // 3. Batch enrich all IPs
      const reputationData = enrichmentService.checkIpReputationBatch(uniqueIps);
      const geoData = enrichmentService.getGeoIpDataBatch(uniqueIps);

      // 4. Filter out null results and build records
      const ipReputationRecord: Record<string, IpReputationData> = {};
      const geoDataRecord: Record<string, GeoIpData> = {};

      for (const ip of uniqueIps) {
        if (reputationData[ip]) {
          ipReputationRecord[ip] = reputationData[ip]!;
        }
        if (geoData[ip]) {
          geoDataRecord[ip] = geoData[ip]!;
        }
      }

      // 5. Update incident with enrichment data (only if we have data)
      const hasReputation = Object.keys(ipReputationRecord).length > 0;
      const hasGeo = Object.keys(geoDataRecord).length > 0;

      if (!hasReputation && !hasGeo) {
        console.log(`[SiemService] No enrichment data available for IPs in incident ${incidentId}`);
        return;
      }

      await this.db
        .updateTable('incidents')
        .set({
          ...(hasReputation && { ip_reputation: ipReputationRecord }),
          ...(hasGeo && { geo_data: geoDataRecord }),
        })
        .where('id', '=', incidentId)
        .where('organization_id', '=', organizationId)
        .execute();

      console.log(
        `[SiemService] Enriched incident ${incidentId}: ${Object.keys(ipReputationRecord).length} IPs with reputation, ${Object.keys(geoDataRecord).length} IPs with geo data`
      );
    } catch (error) {
      // Log error but don't throw - enrichment failure shouldn't break incident creation
      console.error(`[SiemService] Failed to enrich incident ${incidentId}:`, error);
    }
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
      .leftJoin('users', 'users.id', 'incident_history.user_id')
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
      userName: row.userName ?? undefined,
      userEmail: row.userEmail ?? undefined,
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
      category: row.category ?? 'security',
    };
  }

  private mapIncident(row: any): Incident {
    return mapIncidentRow(row);
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
