import type { Severity, IncidentStatus } from '../constants/siem-constants.js';
import type { ErrorGroupStatus } from '../constants/exception-constants.js';
import type { IncidentSource } from '../constants/monitoring-constants.js';

export function getSeverityColor(severity: Severity): string {
  switch (severity) {
    case 'critical':
      return '#a855f7';
    case 'high':
      return '#ef4444';
    case 'medium':
      return '#f59e0b';
    case 'low':
      return '#6b7280';
    case 'informational':
      return '#3b82f6';
    default:
      return '#6b7280';
  }
}

export function getSeverityLabel(severity: Severity): string {
  switch (severity) {
    case 'critical':
      return 'Critical';
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    case 'informational':
      return 'Informational';
    default:
      return severity;
  }
}

export function getSeverityWeight(severity: Severity): number {
  switch (severity) {
    case 'critical':
      return 5;
    case 'high':
      return 4;
    case 'medium':
      return 3;
    case 'low':
      return 2;
    case 'informational':
      return 1;
    default:
      return 0;
  }
}

export function getIncidentStatusLabel(status: IncidentStatus): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'investigating':
      return 'Acknowledged';
    case 'resolved':
      return 'Resolved';
    case 'false_positive':
      return 'False positive';
    default:
      return status;
  }
}

export function getIncidentSourceLabel(source: IncidentSource): string {
  switch (source) {
    case 'sigma':
      return 'Security';
    case 'alert':
      return 'Alert';
    case 'monitor':
      return 'Uptime';
    case 'manual':
      return 'Manual';
    default:
      return source;
  }
}

export function getIncidentStatusColor(status: IncidentStatus): string {
  switch (status) {
    case 'open':
      return '#6b7280';
    case 'investigating':
      return '#f59e0b';
    case 'resolved':
      return '#22c55e';
    case 'false_positive':
      return '#6b7280';
    default:
      return '#6b7280';
  }
}

export function getErrorGroupStatusLabel(status: ErrorGroupStatus): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'resolved':
      return 'Resolved';
    case 'ignored':
      return 'Ignored';
    default:
      return status;
  }
}

export function getErrorGroupStatusColor(status: ErrorGroupStatus): string {
  switch (status) {
    case 'open':
      return '#ef4444';
    case 'resolved':
      return '#22c55e';
    case 'ignored':
      return '#6b7280';
    default:
      return '#6b7280';
  }
}
