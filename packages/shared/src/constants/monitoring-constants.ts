export const MONITOR_TYPES = ['http', 'tcp', 'heartbeat', 'log_heartbeat', 'ssl', 'dns'] as const;
export type MonitorType = (typeof MONITOR_TYPES)[number];

export const MONITOR_STATUS_VALUES = ['up', 'down', 'unknown'] as const;
export type MonitorStatusValue = (typeof MONITOR_STATUS_VALUES)[number];

export const INCIDENT_SOURCES = ['sigma', 'alert', 'monitor', 'manual'] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];
