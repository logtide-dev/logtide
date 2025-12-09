import type { Severity, IncidentStatus } from '../../database/types';

// ============================================================================
// DETECTION EVENTS
// ============================================================================

export interface DetectionEvent {
  id: string;
  time: Date;
  organizationId: string;
  projectId: string | null;
  sigmaRuleId: string;
  logId: string;
  severity: Severity;
  ruleTitle: string;
  ruleDescription: string | null;
  mitreTactics: string[] | null;
  mitreTechniques: string[] | null;
  service: string;
  logLevel: string;
  logMessage: string;
  traceId: string | null;
  matchedFields: Record<string, unknown> | null;
  incidentId: string | null;
}

export interface CreateDetectionEventInput {
  organizationId: string;
  projectId?: string | null;
  sigmaRuleId: string;
  logId: string;
  severity: Severity;
  ruleTitle: string;
  ruleDescription?: string | null;
  mitreTactics?: string[] | null;
  mitreTechniques?: string[] | null;
  service: string;
  logLevel: string;
  logMessage: string;
  traceId?: string | null;
  matchedFields?: Record<string, unknown> | null;
}

// ============================================================================
// INCIDENTS
// ============================================================================

export interface Incident {
  id: string;
  organizationId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  severity: Severity;
  status: IncidentStatus;
  assigneeId: string | null;
  traceId: string | null;
  timeWindowStart: Date | null;
  timeWindowEnd: Date | null;
  detectionCount: number;
  affectedServices: string[] | null;
  mitreTactics: string[] | null;
  mitreTechniques: string[] | null;
  ipReputation: Record<string, unknown> | null;
  geoData: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export interface CreateIncidentInput {
  organizationId: string;
  projectId?: string | null;
  title: string;
  description?: string | null;
  severity: Severity;
  status?: IncidentStatus;
  assigneeId?: string | null;
  traceId?: string | null;
  timeWindowStart?: Date | null;
  timeWindowEnd?: Date | null;
  affectedServices?: string[];
  mitreTactics?: string[];
  mitreTechniques?: string[];
}

export interface UpdateIncidentInput {
  title?: string;
  description?: string | null;
  severity?: Severity;
  status?: IncidentStatus;
  assigneeId?: string | null;
}

export interface IncidentFilters {
  organizationId: string;
  projectId?: string | null;
  status?: IncidentStatus | IncidentStatus[];
  severity?: Severity | Severity[];
  assigneeId?: string | null;
  service?: string;
  technique?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// INCIDENT COMMENTS
// ============================================================================

export interface IncidentComment {
  id: string;
  incidentId: string;
  userId: string;
  comment: string;
  edited: boolean;
  editedAt: Date | null;
  createdAt: Date;
  // Populated fields (via JOIN)
  userName?: string;
  userEmail?: string;
}

export interface CreateIncidentCommentInput {
  incidentId: string;
  userId: string;
  comment: string;
}

// ============================================================================
// INCIDENT HISTORY
// ============================================================================

export interface IncidentHistoryEntry {
  id: string;
  incidentId: string;
  userId: string | null;
  action: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  // Populated fields (via JOIN)
  userName?: string;
  userEmail?: string;
}

// ============================================================================
// SIEM DASHBOARD STATISTICS
// ============================================================================

export interface TopThreat {
  ruleId: string;
  ruleTitle: string;
  count: number;
  severity: Severity;
  mitreTactics: string[] | null;
  mitreTechniques: string[] | null;
}

export interface TimelineBucket {
  timestamp: Date;
  count: number;
}

export interface AffectedService {
  serviceName: string;
  detectionCount: number;
  incidents: number;
  criticalCount: number;
  highCount: number;
}

export interface SeverityDistribution {
  severity: Severity;
  count: number;
  percentage: number;
}

export interface MitreHeatmapCell {
  technique: string;
  tactic: string;
  count: number;
}

export interface DashboardStats {
  topThreats: TopThreat[];
  timeline: TimelineBucket[];
  affectedServices: AffectedService[];
  severityDistribution: SeverityDistribution[];
  mitreHeatmap: MitreHeatmapCell[];
  totalDetections: number;
  totalIncidents: number;
  openIncidents: number;
  criticalIncidents: number;
}

export interface DashboardFilters {
  organizationId: string;
  projectId?: string | null;
  timeRange: '24h' | '7d' | '30d';
  severity?: Severity[];
}

// ============================================================================
// ENRICHMENT DATA
// ============================================================================

export interface IpReputationData {
  ip: string;
  reputation: 'clean' | 'suspicious' | 'malicious';
  abuseConfidenceScore?: number;
  country?: string;
  isp?: string;
  domain?: string;
  usageType?: string;
  source: 'IPsum' | 'AbuseIPDB' | 'manual';
  lastChecked: Date;
}

export interface GeoIpData {
  ip: string;
  country: string;
  countryCode: string;
  city: string | null;
  latitude: number;
  longitude: number;
  timezone: string | null;
  source: 'GeoLite2' | 'MaxMind' | 'manual';
}
