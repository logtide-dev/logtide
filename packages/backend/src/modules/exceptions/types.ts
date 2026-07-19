export type {
  ExceptionLanguage,
  ErrorGroupStatus,
  StructuredStackFrame,
  StructuredException,
  StackFrameRecord,
  ExceptionRecord,
  ErrorGroup,
  ExceptionWithFrames,
  ErrorGroupWithRecentLogs,
  ErrorGroupFilters,
  ErrorGroupTrendBucket,
} from '@logtide/shared';

export { isStructuredException } from '@logtide/shared';

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
  originalFile?: string;
  originalLine?: number;
  originalColumn?: number;
  originalFunction?: string;
}

export interface ParsedException {
  exceptionType: string;
  exceptionMessage: string;
  language: import('@logtide/shared').ExceptionLanguage;
  rawStackTrace: string;
  frames: StackFrame[];
}

export interface CreateExceptionParams {
  organizationId: string;
  projectId: string | null;
  logId: string;
  parsedData: ParsedException;
  fingerprint: string;
  /**
   * Service that emitted the error log. Carried on the exception row so the
   * error-group trigger can attribute the service on every storage engine,
   * not just TimescaleDB (where logs live in Postgres).
   */
  service?: string | null;
}
