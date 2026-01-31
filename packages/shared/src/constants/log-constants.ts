/**
 * Log-related constants and derived types
 *
 * Use these constants for runtime validation and iteration.
 * Types are derived from constants to ensure consistency.
 */

// Log levels (source of truth)
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'critical'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// Span kinds (OpenTelemetry)
export const SPAN_KINDS = ['INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'] as const;
export type SpanKind = (typeof SPAN_KINDS)[number];

// Span status codes (OpenTelemetry)
export const SPAN_STATUS_CODES = ['UNSET', 'OK', 'ERROR'] as const;
export type SpanStatusCode = (typeof SPAN_STATUS_CODES)[number];

// Organization roles
export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

// Auth provider types
export const AUTH_PROVIDER_TYPES = ['local', 'oidc', 'ldap'] as const;
export type AuthProviderType = (typeof AUTH_PROVIDER_TYPES)[number];

// Notification types
export const NOTIFICATION_TYPES = [
  'alert',
  'system',
  'organization_invite',
  'project_update',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
