import { db } from '../../database/connection.js';
import { SiemService } from '../../modules/siem/service.js';
import type { Severity } from '../../database/types';

const siemService = new SiemService(db);

/**
 * Auto-grouping job - Correlate detection events into incidents
 * Runs periodically to group ungrouped detection_events by:
 * 1. Same trace_id (distributed request correlation)
 * 2. Time window proximity (burst detection)
 */
export async function processIncidentAutoGrouping(job: any) {
  console.log('[IncidentAutoGrouping] Starting auto-grouping job');

  try {
    // Get organizations with detection events
    const orgs = await db
      .selectFrom('detection_events')
      .select('organization_id')
      .distinct()
      .where('incident_id', 'is', null) // Only ungrouped events
      .execute();

    console.log(`[IncidentAutoGrouping] Found ${orgs.length} organizations with ungrouped events`);

    for (const org of orgs) {
      await groupByTraceId(org.organization_id);
      await groupByTimeWindow(org.organization_id);
    }

    console.log('[IncidentAutoGrouping] Job completed successfully');
  } catch (error) {
    console.error('[IncidentAutoGrouping] Job failed:', error);
    throw error;
  }
}

/**
 * Group detection events by trace_id
 * Creates one incident per unique trace_id with multiple detections
 */
async function groupByTraceId(organizationId: string): Promise<void> {
  console.log(`[IncidentAutoGrouping] Grouping by trace_id for org ${organizationId}`);

  try {
    // Find detection events with same trace_id (ungrouped)
    const traceGroups = await db
      .selectFrom('detection_events')
      .select([
        'trace_id',
        'project_id',
        db.fn.count<number>('id').as('count'),
        db.fn.max('severity').as('maxSeverity'), // Highest severity wins
        db.fn.array_agg('id').as('eventIds'),
        db.fn.array_agg('service').as('services'),
        db.fn.array_agg('mitre_tactics').as('allTactics'),
        db.fn.array_agg('mitre_techniques').as('allTechniques'),
        db.fn.min('time').as('firstSeen'),
        db.fn.max('time').as('lastSeen'),
      ])
      .where('organization_id', '=', organizationId)
      .where('incident_id', 'is', null)
      .where('trace_id', 'is not', null)
      .groupBy(['trace_id', 'project_id'])
      .having(db.fn.count('id'), '>', 1) // At least 2 events to warrant an incident
      .execute();

    console.log(`[IncidentAutoGrouping] Found ${traceGroups.length} trace-based groups`);

    for (const group of traceGroups) {
      const affectedServices = Array.from(new Set(group.services.flat())).filter(Boolean);
      const allTactics = Array.from(new Set(group.allTactics.flat().filter(Boolean)));
      const allTechniques = Array.from(new Set(group.allTechniques.flat().filter(Boolean)));

      // Create incident
      const incident = await siemService.createIncident({
        organizationId,
        projectId: group.project_id || null,
        title: `Security Incident - Trace ${group.trace_id?.substring(0, 8)}`,
        description: `Auto-grouped incident from ${group.count} detection events correlated by trace ID.`,
        severity: (group.maxSeverity as Severity) || 'medium',
        traceId: group.trace_id || null,
        timeWindowStart: group.firstSeen,
        timeWindowEnd: group.lastSeen,
        affectedServices,
        mitreTactics: allTactics.length > 0 ? allTactics : null,
        mitreTechniques: allTechniques.length > 0 ? allTechniques : null,
      });

      // Link detection events to incident
      await siemService.linkDetectionEventsToIncident(
        incident.id,
        group.eventIds.filter(Boolean)
      );

      console.log(
        `[IncidentAutoGrouping] Created incident ${incident.id} with ${group.count} events (trace: ${group.trace_id})`
      );
    }
  } catch (error) {
    console.error('[IncidentAutoGrouping] Error grouping by trace_id:', error);
  }
}

/**
 * Group detection events by time window
 * Creates incidents for bursts of detections (same service, short time window)
 */
async function groupByTimeWindow(organizationId: string): Promise<void> {
  console.log(`[IncidentAutoGrouping] Grouping by time window for org ${organizationId}`);

  const TIME_WINDOW_MINUTES = 5; // Group events within 5 minutes

  try {
    // Find ungrouped detection events from last hour
    const recentEvents = await db
      .selectFrom('detection_events')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('incident_id', 'is', null)
      .where('trace_id', 'is', null) // Skip events with trace_id (already handled)
      .where('time', '>', new Date(Date.now() - 60 * 60 * 1000)) // Last hour
      .orderBy('time', 'asc')
      .execute();

    if (recentEvents.length === 0) {
      console.log(`[IncidentAutoGrouping] No ungrouped events in time window`);
      return;
    }

    console.log(`[IncidentAutoGrouping] Processing ${recentEvents.length} recent events`);

    // Group events by service + severity + time window
    const groups = new Map<string, typeof recentEvents>();

    for (const event of recentEvents) {
      const windowStart = new Date(event.time);
      windowStart.setMinutes(Math.floor(windowStart.getMinutes() / TIME_WINDOW_MINUTES) * TIME_WINDOW_MINUTES);
      windowStart.setSeconds(0);
      windowStart.setMilliseconds(0);

      const groupKey = `${event.service}_${event.severity}_${windowStart.getTime()}`;

      const existing = groups.get(groupKey) || [];
      existing.push(event);
      groups.set(groupKey, existing);
    }

    // Create incidents for groups with 3+ events
    for (const [groupKey, events] of groups.entries()) {
      if (events.length < 3) continue; // Need at least 3 events to create incident

      const firstEvent = events[0];
      const lastEvent = events[events.length - 1];

      const affectedServices = Array.from(new Set(events.map(e => e.service))).filter(Boolean);
      const allTactics = Array.from(new Set(events.flatMap(e => e.mitre_tactics || []))).filter(Boolean);
      const allTechniques = Array.from(new Set(events.flatMap(e => e.mitre_techniques || []))).filter(Boolean);

      // Create incident
      const incident = await siemService.createIncident({
        organizationId,
        projectId: firstEvent.project_id || null,
        title: `Security Incident - ${firstEvent.service} (Burst Detection)`,
        description: `Auto-grouped incident from ${events.length} detection events in ${TIME_WINDOW_MINUTES}-minute window.`,
        severity: firstEvent.severity as Severity,
        timeWindowStart: firstEvent.time,
        timeWindowEnd: lastEvent.time,
        affectedServices,
        mitreTactics: allTactics.length > 0 ? allTactics : null,
        mitreTechniques: allTechniques.length > 0 ? allTechniques : null,
      });

      // Link detection events to incident
      await siemService.linkDetectionEventsToIncident(
        incident.id,
        events.map(e => e.id)
      );

      console.log(
        `[IncidentAutoGrouping] Created incident ${incident.id} with ${events.length} events (service: ${firstEvent.service}, window: ${TIME_WINDOW_MINUTES}min)`
      );
    }
  } catch (error) {
    console.error('[IncidentAutoGrouping] Error grouping by time window:', error);
  }
}
