import type {
  ExceptionLanguage,
  ErrorGroupStatus,
  ErrorGroupSort,
  ErrorGroupBulkAction,
  ErrorGroupEventDirection,
} from '../constants/exception-constants.js';

export interface StructuredStackFrame {
  file?: string;
  function?: string;
  line?: number;
  column?: number;
  metadata?: Record<string, unknown>;
}

export interface StructuredException {
  type: string;
  message: string;
  stacktrace?: StructuredStackFrame[];
  language?: ExceptionLanguage;
  cause?: StructuredException;
  metadata?: Record<string, unknown>;
  raw?: string;
}

export function isStructuredException(obj: unknown): obj is StructuredException {
  if (!obj || typeof obj !== 'object') return false;
  const ex = obj as Record<string, unknown>;
  return (
    typeof ex.type === 'string' &&
    ex.type.length > 0 &&
    typeof ex.message === 'string' &&
    ex.message.length > 0
  );
}

export interface StackFrameRecord {
  id: string;
  exceptionId: string;
  frameIndex: number;
  filePath: string;
  functionName: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  isAppCode: boolean;
  codeContext: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  originalFile: string | null;
  originalLine: number | null;
  originalColumn: number | null;
  originalFunction: string | null;
  createdAt: Date | string;
}

export interface ExceptionRecord {
  id: string;
  organizationId: string;
  projectId: string | null;
  logId: string;
  exceptionType: string;
  exceptionMessage: string | null;
  language: ExceptionLanguage;
  fingerprint: string;
  rawStackTrace: string;
  frameCount: number;
  createdAt: Date | string;
}

export interface ErrorGroup {
  id: string;
  organizationId: string;
  projectId: string | null;
  projectName?: string | null;
  fingerprint: string;
  exceptionType: string;
  exceptionMessage: string | null;
  language: ExceptionLanguage;
  occurrenceCount: number;
  firstSeen: Date | string;
  lastSeen: Date | string;
  status: ErrorGroupStatus;
  resolvedAt: Date | string | null;
  resolvedBy: string | null;
  affectedServices: string[];
  sampleLogId: string | null;
  // Triage fields (ux16 W5)
  assignedTo?: string | null;
  assignedToName?: string | null;
  assignedToEmail?: string | null;
  regressedAt?: Date | string | null;
  ignoredUntil?: Date | string | null;
  ignoreUntilCount?: number | null;
  ignoredEventCount?: number;
  resolvedByName?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface ExceptionWithFrames {
  exception: ExceptionRecord;
  frames: StackFrameRecord[];
  errorGroupId?: string | null;
}

export interface ErrorGroupWithRecentLogs extends ErrorGroup {
  recentLogs?: Array<{
    id: string;
    time: Date | string;
    service: string;
    message: string;
  }>;
}

export interface ErrorGroupFilters {
  organizationId: string;
  projectId?: string;
  projectIds?: string[];
  status?: ErrorGroupStatus;
  language?: ExceptionLanguage;
  search?: string;
  from?: Date | string;
  to?: Date | string;
  sort?: ErrorGroupSort;
  /** A user uuid or the literal unassigned */
  assignedTo?: string;
  /** Errors that affected this service */
  service?: string;
  limit?: number;
  offset?: number;
}

export interface ErrorGroupTrendBucket {
  timestamp: Date | string;
  count: number;
}

export interface ErrorGroupPatch {
  status?: ErrorGroupStatus;
  assignedTo?: string | null;
  ignoredUntil?: string | null;
  ignoreUntilCount?: number | null;
}

export interface ErrorGroupBulkRequest {
  organizationId: string;
  ids: string[];
  action: ErrorGroupBulkAction;
  assignedTo?: string | null;
  ignoredUntil?: string | null;
  ignoreUntilCount?: number | null;
}

export interface ErrorGroupBulkResult {
  updated: string[];
  skipped: string[];
}

export interface ErrorGroupTrendsResult {
  trends: Record<string, number[]>;
  from: string;
  bucketMs: number;
  buckets: number;
}

export interface ErrorGroupEventLog {
  id: string;
  time: Date | string;
  service: string;
  message: string;
  level: string;
  traceId: string | null;
  spanId: string | null;
  sessionId: string | null;
  hostname: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ErrorGroupEvent {
  /** The exception row id */
  cursor: string;
  exception: ExceptionRecord;
  frames: StackFrameRecord[];
  log: ErrorGroupEventLog | null;
}

export interface ErrorGroupEventsResult {
  events: ErrorGroupEvent[];
  hasOlder: boolean;
  hasNewer: boolean;
}

export interface ErrorGroupTraceMatch {
  errorGroupId: string;
  status: ErrorGroupStatus;
  exceptionType: string;
  exceptionMessage: string | null;
  projectId: string | null;
  logId: string;
  spanId: string | null;
  occurredAt: string;
}

export type { ErrorGroupEventDirection };
