import { z } from 'zod';
import {
  LOG_LEVELS,
  ORG_ROLES,
  SIGMA_LEVELS,
  SIGMA_STATUSES,
  SEVERITIES,
  INCIDENT_STATUSES,
  ERROR_GROUP_STATUSES,
  EXCEPTION_LANGUAGES,
} from '../constants/index.js';

// Schema using constant arrays
export const logLevelSchema = z.enum(LOG_LEVELS);
export const orgRoleSchema = z.enum(ORG_ROLES);
export const sigmaLevelSchema = z.enum(SIGMA_LEVELS);
export const sigmaStatusSchema = z.enum(SIGMA_STATUSES);
export const severitySchema = z.enum(SEVERITIES);
export const incidentStatusSchema = z.enum(INCIDENT_STATUSES);
export const errorGroupStatusSchema = z.enum(ERROR_GROUP_STATUSES);
export const exceptionLanguageSchema = z.enum(EXCEPTION_LANGUAGES);

export const logSchema = z.object({
  time: z.string().datetime().or(z.date()),
  service: z.string().min(1).max(100),
  level: logLevelSchema,
  message: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  trace_id: z.string().optional(),
  span_id: z
    .string()
    .regex(/^[a-f0-9]{16}$/i)
    .optional(),
});

export const ingestRequestSchema = z.object({
  logs: z.array(logSchema).min(1).max(1000),
});

export const alertRuleSchema = z.object({
  name: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
  service: z.string().max(100).optional(),
  level: z.array(logLevelSchema),
  threshold: z.number().int().positive(),
  time_window: z.number().int().positive(),
  email_recipients: z.array(z.string().email()),
  webhook_url: z.string().url().optional(),
});

// Re-export types from constants (for backward compatibility)
export type { LogLevel, OrgRole } from '../constants/log-constants.js';
export type { SigmaLevel, SigmaStatus } from '../constants/sigma-constants.js';
export type { Severity, IncidentStatus } from '../constants/siem-constants.js';
export type { ExceptionLanguage, ErrorGroupStatus } from '../constants/exception-constants.js';

// Schema-inferred types
export type LogInput = z.infer<typeof logSchema>;
export type IngestRequest = z.infer<typeof ingestRequestSchema>;
export type AlertRuleInput = z.infer<typeof alertRuleSchema>;
