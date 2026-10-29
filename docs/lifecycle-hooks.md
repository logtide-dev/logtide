# Lifecycle Hooks

Contract reference for operators and downstream distributions. Last updated 2026-06-06 (#216).

---

## What hooks are (and are not)

Lifecycle hooks are a small, intentional set of named extension points inside the backend. They are not a general event bus, not an async event emitter, and not a plugin system. Each phase is a specific moment in a specific code path where a registered handler may observe an operation (after phases) or observe, mutate, and reject it (before phases).

Nothing is registered by default. In an OSS deployment with no external modules and no downstream bootstrap code, `hasHandlers` returns false for every phase, and the hook path is skipped entirely. There is no overhead.

| Phase | When it runs | Code path |
|---|---|---|
| `beforeIngest` | After auth, PII masking and quota checks; after records are converted to reservoir format; immediately before `reservoir.ingestReturning`. | `IngestionService.ingestLogs` in `modules/ingestion/service.ts`. Covers both HTTP ingest (`POST /api/v1/logs`) and OTLP log ingestion, since both go through this method. |
| `beforeQuery` | At the top of `QueryService.queryLogs`, after request parsing and access checks in the route, before the cache key is built. | `QueryService.queryLogs` in `modules/query/service.ts`. Every log read path goes through it: search, count, histogram, facets and field discovery (and the SSE live tail, which polls search). Trace and log-context endpoints are not covered (see limitations). |
| `beforeAlertEvaluation` | Once per rule, inside the alert evaluation loop, before `checkRule` is called. | `AlertsService.checkAlertRules` in `modules/alerts/service.ts`. |
| `beforeWebhookDispatch` | Immediately before the outbound `safeFetch` call, after headers and payload are fully assembled. | `WebhookProvider.send` in `modules/notification-channels/providers/webhook-provider.ts` (notification channel path) AND `sendWebhookNotification` in `queue/jobs/alert-notification.ts` (legacy alert-rule `webhook_url` path). Both paths are covered. |
| `afterIngest` | After the batch finishes processing, including paths where nothing was written (all records rejected or hook-filtered). | `IngestionService.ingestLogs` in `modules/ingestion/service.ts`. Covers both HTTP and OTLP ingest paths. |
| `afterAlertTriggered` | Once per notification, not per evaluation: when a rule transitions to firing, and on each re-notification of a rule that keeps firing. Fires after the alert history row is persisted, before notification jobs are enqueued. Steady firing without a re-notification, snoozed transitions and resolves do not fire it. | `AlertsService.checkAlertRules` in `modules/alerts/service.ts`. |
| `afterWebhookDispatch` | After each webhook delivery attempt completes, on both the queued and synchronous dispatch paths. | Inside `deliverOnce` in `modules/webhooks/dispatcher.ts`. Covers every dispatcher delivery: queued deliveries from the webhook-delivery job (alert, error, monitor, incident events and replays) and synchronous deliveries from the notification-channel provider (including channel tests). |

---

## Context contract per phase

These interfaces are the source of truth. Handlers must not mutate fields marked `readonly`.

### `BeforeIngestContext`

```ts
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
```

| Field | Status | Notes |
|---|---|---|
| `organizationId` | STABLE-READONLY | Null when the project's organization cannot be resolved. |
| `projectId` | STABLE-READONLY | Always set. |
| `eventCount` | STABLE-READONLY | Snapshot taken before hooks run; not recomputed if `records` is mutated. |
| `byteSize` | STABLE-READONLY | `JSON.stringify(records)` byte length, computed only when handlers exist (zero-overhead guard). Not recomputed after mutation. |
| `records` | MUTABLE | May be filtered, redacted, reordered, or replaced with a new array. If the array is emptied, ingestion returns 0 and no downstream processing happens. If records are filtered or replaced, downstream consumers (Sigma detection, exception parsing, pipeline processing, metering, correlation) are automatically realigned with the new array so they never see phantom entries; newly created records (records with no original counterpart) are synthesized as minimal `LogInput` for downstream. |

**Mutating `records` in place vs. cloning.** The downstream realignment is keyed by object identity: a record is considered "original" if it is the same object reference as one in the pre-hook snapshot. A handler that clones records (`ctx.records = ctx.records.map(r => ({ ...r }))`) produces new objects with no match in the snapshot; all cloned records are treated as hook-created and the synthesized `LogInput` view loses span/session ids. Mutate fields in place or filter the array; do not clone records you want to keep.

**Tenancy guard on `projectId`.** The ingestion service enforces that every record's `projectId` matches the original project after hooks run. Changing a record's `projectId` is treated as a cross-tenant write attempt and fails closed with HTTP 500 (a `HookExecutionError` whose cause is "beforeIngest hook changed record projectId"). This is a hard guarantee: hooks cannot move data across tenant boundaries even if the operator intends it.

### `BeforeQueryContext`

```ts
export interface BeforeQueryContext {
  /** From the ALS RequestContext; null on session-auth routes (org not bound). */
  readonly organizationId: string | null;
  /** Informational snapshot of params.projectId taken before hooks ran. */
  readonly projectIds: string[];
  /** MUTABLE: narrow the time range, force filters, cap limit, etc. */
  params: LogQueryParams;
}
```

| Field | Status | Notes |
|---|---|---|
| `organizationId` | STABLE-READONLY | Null on session-auth query routes where the org is not bound to the ALS context. |
| `projectIds` | STABLE-READONLY | Informational snapshot of `params.projectId` at hook entry. |
| `params` | MUTABLE | Mutations drive both the cache key and the reservoir read. Mutating `params` before the cache key is built is the intended way to force time-range caps, inject mandatory filters, or reduce the limit. |

### `BeforeAlertEvaluationContext`

```ts
export interface BeforeAlertEvaluationContext {
  readonly organizationId: string;
  readonly ruleId: string;
  readonly ruleType: 'threshold' | 'rate_of_change';
}
```

| Field | Status | Notes |
|---|---|---|
| `organizationId` | STABLE-READONLY | Always set (alert rules are org-scoped). |
| `ruleId` | STABLE-READONLY | UUID of the rule about to be evaluated. |
| `ruleType` | STABLE-READONLY | Rule kind. |

All fields are readonly. This context is informational only; there is no mutable surface. Rejection skips the rule for this evaluation cycle.

### `BeforeWebhookDispatchContext`

```ts
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
```

| Field | Status | Notes |
|---|---|---|
| `organizationId` | STABLE-READONLY | Null when the channel has no org context. |
| `channelId` | STABLE-READONLY | Present on the notification-channel path. Also set on the legacy alert-rule `webhook_url` path when the webhook comes from a notification channel (the job resolves the channel id and passes it through). May be undefined only on hypothetical future callers that dispatch without a channel id. |
| `ruleId` | STABLE-READONLY | Present on the legacy alert-rule `webhook_url` path; absent on the channel path. On the legacy path both `ruleId` and `channelId` are now available. |
| `url` | STABLE-READONLY | The validated webhook URL. Readonly by design: changing the target would bypass the SSRF-validated channel configuration. `safeFetch` still validates the URL against the SSRF guard regardless of what a hook does to other fields. |
| `targetHost` | STABLE-READONLY | Hostname extracted from `url`. Provided for convenience (avoids re-parsing in handlers). |
| `headers` | MUTABLE | Add, remove or replace outbound headers (e.g. HMAC signatures, compliance headers). |
| `body` | MUTABLE | Redact or enrich the JSON payload before it is sent. |

---

## After-phase contexts

After-phase handlers are fire-and-forget observers. They cannot mutate or reject: all context fields are `readonly`, and there is no mutable surface. Throwing from an after-phase handler is caught by the registry, logged with `console.warn`, and discarded. The operation that triggered the hook has already completed; the error does not affect its outcome.

The `hasHandlers` guard applies to after phases the same as before phases. When no handlers are registered, the hook path is skipped at zero overhead.

After-phase handlers are registered identically to before-phase handlers: via `hooks.register()` in code, or via `HOOKS_MODULES` for container deployments. The same module can register both before and after handlers.

### `AfterIngestContext`

```ts
export interface AfterIngestContext {
  readonly organizationId: string | null;
  readonly projectId: string;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly rejectionReasons: readonly string[];
}
```

Fires when the batch finishes processing, including paths where nothing was written (all records rejected by ingestion-side checks or filtered by a beforeIngest handler). Covers both the HTTP ingest (`POST /api/v1/logs`) and OTLP log ingest paths. Carries counts only; log content is not available at this point.

| Field | Notes |
| --- | --- |
| `organizationId` | Null when the project's organization cannot be resolved (same as `BeforeIngestContext`). |
| `projectId` | Always set. |
| `acceptedCount` | Number of records written to the reservoir. |
| `rejectedCount` | Number of records dropped by ingestion-side checks (currently: PII masking failures). Records filtered by beforeIngest handlers are not counted here; operators control those handlers and can track counts inside them. |
| `rejectionReasons` | Readonly array of reason strings for ingestion-side rejections. May be empty. Records filtered by beforeIngest handlers do not contribute to this array. |

### `AfterAlertTriggeredContext`

```ts
export interface AfterAlertTriggeredContext {
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly historyId: string;
  readonly logCount: number;
  readonly baselineMetadata: Readonly<Record<string, unknown>> | null;
}
```

Fires after an alert trigger is persisted to alert history, before notification jobs are enqueued. This is a good place to emit metrics or audit events for alert activity.

| Field | Notes |
| --- | --- |
| `organizationId` | Always set (alert rules are org-scoped). |
| `projectId` | Null for org-wide rules without a project filter. |
| `ruleId` | UUID of the alert rule that fired. |
| `ruleName` | Display name of the rule. |
| `historyId` | UUID of the new alert history record. |
| `logCount` | Number of matching log events that triggered the rule. |
| `baselineMetadata` | Non-null for anomaly/rate-of-change rules; contains baseline and deviation stats. Null for plain threshold rules. |

### `AfterWebhookDispatchContext`

```ts
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
```

Fires inside `deliverOnce` after each webhook delivery attempt completes. Covers every dispatcher delivery: queued deliveries from the webhook-delivery job (alert, error, monitor, incident events and replays) and synchronous deliveries from the notification-channel provider (including channel tests). Useful for delivery metrics and audit logging.

| Field | Notes |
| --- | --- |
| `organizationId` | Null when the channel has no org context. |
| `channelId` | Present on the notification-channel path. |
| `ruleId` | Present on the legacy alert-rule path. |
| `eventType` | The webhook event type string (e.g. `alert.triggered`). |
| `url` | The validated webhook URL that was called. |
| `success` | `true` if the attempt received a 2xx response. |
| `statusCode` | HTTP response status code, or `null` if the request never completed (timeout, network error). |
| `durationMs` | Round-trip time for this attempt in milliseconds. |
| `error` | Error message string if `success` is `false`, otherwise `null`. |
| `retryable` | `true` if the failure is eligible for a retry attempt (5xx, 429, timeout). |

---

## Execution guarantees

Handlers registered for a phase run sequentially in registration order. The phase is not parallelized. Each handler awaits the previous one before the next starts, so a later handler sees any mutations made by an earlier one.

The first handler to throw short-circuits the phase. Subsequent handlers do not run.

`eventCount` and `byteSize` on `BeforeIngestContext` are snapshots taken before any handler runs. They are not recomputed after a handler mutates `records`.

---

## Rejection semantics

### `HookRejectionError`

```ts
export class HookRejectionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 403
  ) { ... }
}
```

A handler throws `HookRejectionError` to abort the operation intentionally. This applies to before phases only. After phases are fire-and-forget: any thrown error (including `HookRejectionError`) is caught, logged with `console.warn`, and silently discarded. The operation has already completed and cannot be cancelled.

For before phases, the registry detects `HookRejectionError` with `instanceof HookRejectionError` and propagates it as-is; it is not wrapped. The effect depends on the phase:

| Phase | Effect of `HookRejectionError` |
|---|---|
| `beforeIngest` | Ingestion aborts. The global error handler surfaces `statusCode`, `code` and `message` in the HTTP response (same path as `CapabilityError` and `QuotaExceededError`). The client receives a machine-readable error body. |
| `beforeQuery` | The query aborts. Same HTTP error surface as above. |
| `beforeAlertEvaluation` | That rule is skipped for this evaluation cycle. The rejection is logged (`[Alerts] Rule <id> skipped by hook: <code>`). The rest of the batch continues. |
| `beforeWebhookDispatch` (channel path) | Delivery is recorded as failed. The provider returns `{ success: false, error: 'Webhook dispatch rejected: <message>' }`. No retry. |
| `beforeWebhookDispatch` (legacy path) | The rejection propagates out of `sendWebhookNotification`; the job's catch records `HookRejectionError.message` as a delivery failure string in alert history (raw message, without the channel path's `Webhook dispatch rejected:` prefix). No retry. |

### Unexpected errors (fail-closed)

Any exception that is NOT an `instanceof HookRejectionError` is caught by the registry, logged server-side with the original error, and wrapped in `HookExecutionError`:

```ts
export class HookExecutionError extends Error {
  readonly code = 'hook.execution_failed';
  readonly statusCode = 500;
  constructor(public readonly phase: HookPhase, cause?: unknown) { ... }
}
```

The original error is chained via `Error.cause` and logged on the server. `HookExecutionError` propagates up as an unhandled server error, which the global error handler catches. Because the global error handler treats all 5xx errors uniformly, the client receives `{ statusCode: 500, error: 'Internal Server Error' }` with no `code` field - `hook.execution_failed` and the chained cause appear in server logs only, never in the response body.

Exception for OTLP: on the `POST /v1/otlp/logs` route, a `HookExecutionError` (statusCode 500) is caught by the route's own catch block and translated to HTTP 503 with `{ partialSuccess: { rejectedLogRecords: -1, errorMessage: 'temporary ingestion failure' } }`. The 503 signals a retryable server-side failure so OTLP exporters retry rather than dropping the batch.

Exception for the alert evaluation loop: an unexpected hook error is caught at the call site. The rule is skipped and the error is logged (`[Alerts] Rule <id> skipped, hook failed: <err>`), but `HookExecutionError` is not rethrown. The batch survives.

---

## Registering hooks

### Code-level registration (downstream distributions)

Import and call `hooks.register()` in your bootstrap, before the server starts accepting requests:

```ts
import { hooks } from 'packages/backend/src/hooks/index.js';
import { HookRejectionError } from 'packages/backend/src/hooks/index.js';

hooks.register('beforeIngest', async (ctx) => {
  if (ctx.byteSize > 5 * 1024 * 1024) {
    throw new HookRejectionError('policy.batch_too_large', 'Batch exceeds 5MB', 429);
  }
});
```

This works because the distribution builds from source and can import `HookRejectionError` directly. The `instanceof` check in the registry matches, and the error surfaces as a clean 429 to the client.

### `HOOKS_MODULES` (container deployments)

Set `HOOKS_MODULES` to a comma-separated list of absolute paths to `.js` or `.mjs` files. Each file must default-export a function with the signature `(hooks: HookRegistry, helpers: HookModuleHelpers) => void | Promise<void>` (the second argument is optional for modules that only observe or mutate). The loader calls this function at boot, on both the server process and the worker process. A load failure (missing file, bad export, any error from the register function) is fatal: the process exits rather than running without the intended policy.

```
HOOKS_MODULES=/etc/logtide/hooks/policy.mjs,/etc/logtide/hooks/audit.mjs
```

The `helpers` argument carries the `HookRejectionError` class so external modules can produce clean 4xx rejections without importing backend internals. The registry's `instanceof HookRejectionError` check uses the same class reference passed through helpers, so the identity matches correctly.

Example module:

```js
// /etc/logtide/hooks/policy.mjs
export default function register(hooks, { HookRejectionError }) {
  hooks.register('beforeIngest', async (ctx) => {
    // Reject: block batches that exceed the policy limit with a clean 429
    if (ctx.byteSize > 5 * 1024 * 1024) {
      throw new HookRejectionError('policy.batch_too_large', 'Batch exceeds 5MB policy', 429);
    }
    // Observe-only: log large batches without rejecting
    if (ctx.eventCount > 10000) {
      console.warn(`[Policy] Large batch from project ${ctx.projectId}: ${ctx.eventCount} events`);
    }
    // Mutate: strip a sensitive field from all records before the reservoir write
    for (const record of ctx.records) {
      if (record.metadata) {
        delete record.metadata.internal_token;
      }
    }
  });

  hooks.register('beforeWebhookDispatch', async (ctx) => {
    // Inject a signing header
    ctx.headers['X-LogTide-Sig'] = computeHmac(ctx.body, process.env.WEBHOOK_SECRET);
  });
}
```

Throwing `HookRejectionError` from an external module surfaces a clean 4xx with a machine-readable code to the client. Any other error fails closed as HTTP 500: the operation is still blocked, but the client only sees `{ statusCode: 500, error: 'Internal Server Error' }` (the global error handler strips all internal detail from 5xx responses). `hook.execution_failed` and the original cause are in server logs only. Observe and mutate use cases never need to throw.

---

## Conventions

**No unbounded I/O.** Hooks run on the hot path. There is no timeout enforced in v1. Handlers must not perform unbounded network calls, uncached database reads, or any operation whose latency is uncontrolled. Keep handlers fast; add your own timeout wrapper if you need to call an external service.

**ALS RequestContext.** Hooks can read the current request context via `context.currentOrNull()` from `@logtide/shared/context`. This gives access to `organizationId`, `requestId`, `ip`, `userAgent`, and the authenticated actor. Note that `organizationId` is null on session-auth query paths (the org is not bound to the ALS context for those routes), which is why `BeforeQueryContext.organizationId` may also be null.

**Error cause.** When logging unexpected hook failures server-side, the original error is available as `err.cause` on the `HookExecutionError`. Use this when adding structured logging to hook infrastructure.

---

## v1 Limitations

- `beforeQuery` runs once per log read request (search, count, histogram, facets, field discovery), so a hook that forces a filter narrows all of them alike. It does not intercept the trace correlation or log-context endpoints.
- `beforeQuery` also fires inside the SSE live-tail polling loop (`GET /api/v1/logs/stream`), which calls `queryService.queryLogs` on a `setInterval` at roughly 1-second intervals for each connected client. Hooks fire once per poll tick. A rejection or unexpected hook error inside the interval catches the error, terminates the stream (`reply.raw.end()`), and gives the client no visible error reason (only the server-sent `error` event console-logged server-side). `beforeQuery` handlers must be cheap and idempotent to avoid degrading live-tail for every connected viewer.
- `eventCount` and `byteSize` on `BeforeIngestContext` are pre-hook snapshots. They are not recomputed after `records` is mutated, filtered or replaced. If you need the post-mutation count, use `ctx.records.length` directly.
- No timeout is enforced on handlers. This is intentional in v1 to avoid surprising registered handlers; it may be added in a future version with an opt-in per-handler budget.
- There is no hook for OTLP trace or metric ingestion paths in v1.
- After-phase errors are logged with `console.warn` and never surfaced to the caller. If an after-phase handler performs I/O (metrics, audit writes, etc.) it is responsible for its own error handling and timeouts; failures are invisible to the requester.
- There is no `afterQuery` phase in v1.
