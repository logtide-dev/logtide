/**
 * Exception Tracking Types
 *
 * Types for stack trace parsing, fingerprinting, and error grouping.
 */

export type ExceptionLanguage = 'nodejs' | 'python' | 'java' | 'go' | 'php' | 'unknown';

export interface StackFrame {
  frameIndex: number;
  filePath: string;
  functionName?: string;
  lineNumber?: number;
  columnNumber?: number;
  isAppCode: boolean;
  codeContext?: {
    pre?: string[];
    line?: string;
    post?: string[];
  };
  metadata?: Record<string, unknown>;
}

export interface ParsedException {
  exceptionType: string;
  exceptionMessage: string;
  language: ExceptionLanguage;
  rawStackTrace: string;
  frames: StackFrame[];
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
  createdAt: Date;
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
  createdAt: Date;
}

export type ErrorGroupStatus = 'open' | 'resolved' | 'ignored';

export interface ErrorGroup {
  id: string;
  organizationId: string;
  projectId: string | null;
  fingerprint: string;
  exceptionType: string;
  exceptionMessage: string | null;
  language: ExceptionLanguage;
  occurrenceCount: number;
  firstSeen: Date;
  lastSeen: Date;
  status: ErrorGroupStatus;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  affectedServices: string[];
  sampleLogId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExceptionWithFrames {
  exception: ExceptionRecord;
  frames: StackFrameRecord[];
}

export interface ErrorGroupWithStats extends ErrorGroup {
  recentLogs?: Array<{
    id: string;
    time: Date;
    service: string;
    message: string;
  }>;
}

export interface ErrorGroupFilters {
  organizationId: string;
  projectId?: string;
  status?: ErrorGroupStatus;
  language?: ExceptionLanguage;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ErrorGroupTrendBucket {
  timestamp: Date;
  count: number;
}

export interface CreateExceptionParams {
  organizationId: string;
  projectId: string | null;
  logId: string;
  parsedData: ParsedException;
  fingerprint: string;
}
