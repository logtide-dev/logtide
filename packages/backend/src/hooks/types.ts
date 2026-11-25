import type { LogLevel as ReservoirLogLevel } from '@logtide/reservoir';
import type { LogQueryParams } from '../modules/query/service.js';

/**
 * Well-known lifecycle hook phases (#216). A small, intentional set of
 * extension points - NOT a general event bus. Hooks are no-ops in OSS
 * (nothing registered by default); operators and downstream distributions
 * register handlers via the exported registry or HOOKS_MODULES.
 */
export type HookPhase =
  | 'beforeIngest'
  | 'beforeQuery'
  | 'beforeAlertEvaluation'
  | 'beforeWebhookDispatch'
  | 'afterIngest'
  | 'afterAlertTriggered'
  | 'afterWebhookDispatch';

export type BeforeHookPhase =
  | 'beforeIngest'
  | 'beforeQuery'
  | 'beforeAlertEvaluation'
  | 'beforeWebhookDispatch';

export type AfterHookPhase =
  | 'afterIngest'
  | 'afterAlertTriggered'
  | 'afterWebhookDispatch';

/**
 * The reservoir-bound log record shape built by IngestionService.ingestLogs
 * right before the reservoir write. Hooks may mutate/replace `records` in
 * BeforeIngestContext; everything else is a readonly snapshot.
 */
export interface IngestLogRecord {
  time: Date;
  projectId: string;
  service: string;
  level: ReservoirLogLevel;
  message: string;
  metadata?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  sessionId?: string;
}

/** Runs after auth + PII masking + quota checks, before the reservoir write. */
export interface BeforeIngestContext {
  readonly organizationId: string | null;
  readonly projectId: string;
  /** Record count before hooks ran (snapshot; not recomputed after mutation). */
  readonly eventCount: number;
  /** Serialized-size estimate in bytes, computed only when handlers exist. */
  readonly byteSize: number;
  /** MUTABLE: filter/redact/modify entries, or assign a new array. */
  records: IngestLogRecord[];
}

/** Runs at the top of QueryService.queryLogs, before the cache key is built. */
export interface BeforeQueryContext {
  /** From the ALS RequestContext; null on session-auth routes (org not bound). */
  readonly organizationId: string | null;
  /** Informational snapshot of params.projectId taken before hooks ran. */
  readonly projectIds: string[];
  /** MUTABLE: narrow the time range, force filters, cap limit, etc. */
  params: LogQueryParams;
}

/** Runs per rule inside the alert evaluation loop. Rejection skips the rule. */
export interface BeforeAlertEvaluationContext {
  readonly organizationId: string;
  readonly ruleId: string;
  readonly ruleType: 'threshold' | 'rate_of_change' | 'metric';
}

/** Runs immediately before the outbound webhook HTTP call (safeFetch). */
export interface BeforeWebhookDispatchContext {
  readonly organizationId: string | null;
  /** Set on the notification-channel path. */
  readonly channelId?: string;
  /** Set on the legacy alert-rule webhook path. */
  readonly ruleId?: string;
  /** READONLY: mutating the target would sidestep validated channel config. */
  readonly url: string;
  readonly targetHost: string;
  /** MUTABLE: e.g. inject signing/compliance headers. */
  headers: Record<string, string>;
  /** MUTABLE: redact or enrich the payload before it leaves. */
  body: Record<string, unknown>;
}

/** Fired after a batch finishes ingestion. No log content: counts only. */
export interface AfterIngestContext {
  readonly organizationId: string | null;
  readonly projectId: string;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly rejectionReasons: readonly string[];
}

/** Fired after an alert trigger is persisted, before notification outcomes. */
export interface AfterAlertTriggeredContext {
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly historyId: string;
  readonly logCount: number;
  readonly baselineMetadata: Readonly<Record<string, unknown>> | null;
}

/** Fired after each webhook delivery attempt completes (queued and sync paths). */
export interface AfterWebhookDispatchContext {
  readonly organizationId: string | null;
  readonly channelId?: string;
  readonly ruleId?: string;
  readonly eventType: string;
  readonly url: string;
  readonly success: boolean;
  readonly statusCode: number | null;
  readonly durationMs: number;
  readonly error: string | null;
  readonly retryable: boolean;
}

export type HookContextMap = {
  beforeIngest: BeforeIngestContext;
  beforeQuery: BeforeQueryContext;
  beforeAlertEvaluation: BeforeAlertEvaluationContext;
  beforeWebhookDispatch: BeforeWebhookDispatchContext;
  afterIngest: AfterIngestContext;
  afterAlertTriggered: AfterAlertTriggeredContext;
  afterWebhookDispatch: AfterWebhookDispatchContext;
};

export type HookHandler<P extends HookPhase> = (
  ctx: HookContextMap[P]
) => void | Promise<void>;
