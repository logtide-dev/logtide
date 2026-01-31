import type { ExceptionLanguage, ErrorGroupStatus } from '../constants/exception-constants.js';

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
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface ExceptionWithFrames {
  exception: ExceptionRecord;
  frames: StackFrameRecord[];
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
  status?: ErrorGroupStatus;
  language?: ExceptionLanguage;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ErrorGroupTrendBucket {
  timestamp: Date | string;
  count: number;
}
