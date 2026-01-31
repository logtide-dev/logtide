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
}
