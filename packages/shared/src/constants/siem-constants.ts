/**
 * SIEM (Security Incident & Event Management) constants and derived types
 */

// SIEM severities (note: same values as SIGMA_LEVELS but semantically distinct)
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'] as const;
export type Severity = (typeof SEVERITIES)[number];

// Incident statuses
export const INCIDENT_STATUSES = [
  'open',
  'investigating',
  'resolved',
  'false_positive',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
