# Changelog

All notable changes to LogTide will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [Unreleased]

## [1.0.3] - 2026-06-26

A security-focused release. It resolves a batch of privately reported issues (coordinated disclosure via KIberblick.de): cross-tenant read on the dashboard API endpoints, stored XSS via OTLP `service.name` in the service map, an open redirect on the auth-free login/register path, a DNS-rebinding gap in the SSRF guard's HTTP path, a first-admin bootstrap promotion race, and a capability-limit check-then-act race; trace span attributes are now PII-masked as well, and `service.name` is sanitized at ingestion as defense in depth. No database migrations; drop-in upgrade. Alongside the security work: two correctness follow-ups from the multi-engine bug-hunt sweep (issue #255): Sigma detection now honors full SigmaHQ field-modifier chains, and the service-map p95 is a true window percentile on every storage engine. The storage-layer change was validated against real ClickHouse, MongoDB and TimescaleDB. This line also fixes two operational bugs: a Redis memory leak where completed/failed BullMQ jobs were never evicted, and a nightly SigmaHQ sync that re-imported the whole catalog as enabled and auto-created alert rules. Plus a few frontend touch-ups: theme-aware trace/session IDs in the log detail, per-occurrence trace links on the error page, metadata copy buttons, a breadcrumbs timeline and nested metadata columns in log search.

### Security
- **Cross-tenant read on the dashboard API endpoints (fixed)**: the five dashboard endpoints (`/api/v1/dashboard/stats`, `/timeseries`, `/top-services`, `/timeline-events`, `/recent-errors`) plus the newer `/activity-overview` took `organizationId` from the query string and only ran the organization-membership check behind `if (request.user?.id)`, which is set for session auth only. For API-key auth `requireFullAccess` lets any non-write key through without setting `request.user`, so the membership check was skipped and the org was read from the attacker-supplied query rather than the key's bound `request.organizationId`; when `projectId` was omitted the project-in-org check was skipped too. A holder of any full-access API key (bound to org A) could read another organization's dashboard data by passing that org's id. All six handlers now route through a shared `resolveDashboardScope` that, for API-key auth, requires the requested org to match the key's bound org and the requested project to match (defaulting to the key's bound project when omitted), mirroring `resolveQueryProjectId` which already protects the query and traces routes. Session auth keeps the org-membership and project-in-org checks. Reported privately via KIberblick.de
- **Stored XSS via OTLP `service.name` in the service map (fixed)**: `service.name` from ingested traces passed through `sanitizeForPostgres`, which only strips null bytes, so `< > " '` survived into `span.service_name` and were served verbatim by the service-map API. In `ServiceMap.svelte` the ECharts `tooltip.formatter` returned a raw HTML string built from `params.name` / `params.data.source` / `params.data.target`, and ECharts renders tooltip output as HTML, so a `service.name` like `<img src=x onerror=...>` executed in the browser of any operator who opened the project's service map and hovered the node or edge. User-derived tooltip values are now HTML-escaped via a shared `escapeHtml` util (also adopted by the SIEM HTML report builder, replacing its private copy). Stored data is left raw on purpose (escaping at the sink, not the store, avoids double-encoding and keeps the JSON API correct). Reported privately via KIberblick.de
- **Open redirect on auth-free login/register (fixed)**: in `authMode === 'none'` deployments the login and register pages forwarded the user-supplied `redirect` query parameter via `goto(redirectUrl)` with no validation, while the normal submit path already checked it. The check now lives in a shared `isSafeInternalPath`/`safeRedirect` helper used by both the auth-free and normal paths on both pages; it requires a single-leading-slash path and rejects protocol-relative forms including the backslash variant (`/\evil.com`) that some browsers normalize to `//`. Reported privately via KIberblick.de
- **SSRF guard now pins the validated IP (DNS rebinding hardening)**: `safeFetch` resolved and validated the target host, then let `fetch()` re-resolve at connect time, leaving a resolve-then-connect window where a hostname could rebind to an internal address between check and connect (the TCP monitor path already pinned, the HTTP path did not). The HTTP(S) path now connects through a per-request undici dispatcher whose lookup is pinned to the already-validated address, so the socket reaches the exact IP that passed validation; TLS SNI and certificate validation still use the original hostname. Reported privately via KIberblick.de
- **First-admin bootstrap race (fixed)**: `createUser` decided the automatic first-admin promotion with a non-atomic `hasAnyAdmin()` check followed by a separate insert, so concurrent registrations in the zero-admin window could each observe "no admin yet" and all be promoted. The check-then-insert now runs inside a transaction holding a Postgres advisory lock, so at most one registration wins the promotion. Only reachable before the first admin exists (and closed entirely when `INITIAL_ADMIN_*` is set). Reported privately via KIberblick.de
- **Capability limit check-then-act race (fixed)**: resource-creating routes (api keys, custom dashboards, alert rules, sigma rule import/enable, notification channels) ran `COUNT -> assertWithinLimit -> insert` without serialization, so parallel requests could each read a count under the limit and then all insert, exceeding a configured finite cap (a quota bypass, not a tenant boundary; the OSS default has no finite limits). The count+create now runs through a shared `withLimitLock` helper that takes a per-organization, per-capability transaction-scoped advisory lock, so concurrent creators of the same resource type serialize and the cap holds. Reported privately via KIberblick.de
- **Defense-in-depth on OTLP `service.name` at ingestion**: complementing the service-map output-encoding fix above, ingested `service.name` (for logs, spans and metrics) is now run through a shared `sanitizeServiceName` that strips control characters (C0/DEL/C1, including null bytes) and caps the length, while deliberately preserving otherwise legitimate characters (escaping still happens at each sink). This keeps a raw payload from resurfacing through a sink that is added later or forgets to encode. Suggested by KIberblick.de
- **PII masking now also covers trace span attributes**: masking was wired only into log ingestion, so trace spans were stored with their attributes verbatim. Spans routinely carry `http.request_body` / `http.response_body` (plaintext credentials, JWTs), `net.peer.ip` and user agents, all persisted unmasked. `tracesService.ingestSpans` now runs the same org/project masking rules over each span's `attributes`, `resourceAttributes` and event/link attributes before storage, and drops (fail-closed) any span whose masking throws. Because request/response bodies are opaque stringified JSON that field-name rules can't see into, those body attributes are deep-masked (parse the JSON, mask `password`/`token`/email inside, re-serialize) with full redaction as a fallback when the value is not parseable JSON. Metric attributes are not yet masked (tracked separately)

### Added
- **Per-occurrence trace links on the error detail page**: each log in an error group's Logs tab now shows a "View Trace" action when that log carries a trace context, opening the existing trace timeline. The error-group logs endpoint (`GET /api/v1/error-groups/:id/logs`) now surfaces the `traceId` it already loaded from storage and previously discarded; no schema change, no migration
- **Copy buttons on metadata blocks**: the log search expanded detail and the Log Context dialog now have a one-click copy on each metadata block (with copied feedback), so a log's metadata JSON can be grabbed without selecting it by hand
- **Breadcrumbs timeline in the log search detail**: when a log carries `metadata.breadcrumbs`, the expanded row now renders a collapsible "Breadcrumbs (N)" timeline (the same `BreadcrumbTimeline` view already used in the Log Context dialog) instead of leaving them buried in the raw metadata JSON
- **Nested metadata columns**: custom metadata columns in log search now accept dot-notation paths (e.g. `sdk.name`) to read into nested objects. Exact top-level keys still win first, so flat keys that contain dots (e.g. `debug.trace_id`) keep resolving; object/array values render as compact JSON, and the full value is available on hover

### Fixed
- **Admin usage page returned 403 for organizations the admin wasn't a member of**: the metering endpoints (`/usage`, `/usage/breakdown`, `/usage/storage`, `/usage/capabilities`) gated solely on org membership, so the platform Admin > Usage page (which lists every organization) got "Forbidden" whenever a selected org wasn't one the admin personally belonged to. Platform admins (`is_admin`) now bypass the membership check on these read endpoints; the queries stay filtered by the requested `organizationId`, so tenant scoping is unchanged
- **Trace volume / trace latency dashboard panels were empty on ClickHouse and MongoDB**: both panel fetchers read span data straight from the Postgres `spans` hypertable and its continuous aggregates and short-circuited to an empty series when `reservoir.getEngineType() !== 'timescale'`, so on ClickHouse/MongoDB deployments (where spans live in those engines) the panels returned no data. Added a multi-engine `reservoir.getSpanTimeseries` (time-bucketed span volume + true window p50/p95/p99 from raw spans: `percentile_cont` on TimescaleDB, `quantile` on ClickHouse, `$percentile` on MongoDB) and switched both fetchers to it. The ClickHouse and MongoDB paths mirror the validated `getServiceHealthStats` percentile approach
- **UI dates and numbers no longer follow the machine locale**: across the frontend many `toLocaleDateString`/`toLocaleTimeString`/`toLocaleString` calls were made with no locale (or `undefined`), so on a non-English host they rendered localized weekdays/months (e.g. "mercoledi") and localized number grouping. All user-facing date/time/number formatting is now pinned to `en-US` (the project convention), so the UI reads the same regardless of the server/browser locale. Swept 51 files
- **Error detail trend bars were invisible**: the occurrence-trend chart on the error detail page rendered only the weekday labels and no bars. The bars used a percentage `height` whose parent column had no definite height (`items-end` left the columns sized to content), so the percentage collapsed to zero. The columns now take full height with the bar anchored in a flex track, so the bars render (a small baseline is kept for non-zero days)
- **Redis memory leak: completed/failed jobs were never evicted**: the BullMQ queue adapter defined sane `removeOnComplete`/`removeOnFail` cleanup defaults on the queue, but its `add()` then passed `removeOnComplete: undefined` / `removeOnFail: undefined` on every job. BullMQ merges per-job options over the queue defaults with `Object.assign`, which copies the `undefined` keys and so wiped the cleanup config, making BullMQ retain every completed and failed job hash (and its full payload) in Redis forever. With the high-volume ingestion jobs (`sigma-detection`, `log-pipeline`, `exception-parsing`) carrying whole log batches, Redis grew unbounded (multi-GB) while the dashboard still showed 0 waiting / 0 failed. `add()` now omits those keys unless the caller sets them, so the queue-level retention (keep 100 completed/1h, 50 failed/24h) applies
- **Nightly SigmaHQ sync re-imported the entire catalog and auto-created alert rules**: the 2:30 AM cron called the sync with no rule selection, falling into the "fetch ALL rules" path that pulled the whole SigmaHQ catalog (~2000+ rules) and inserted them all as `enabled = true` (the `sigma_rules.enabled` column defaults to true and the insert never set it), so an org that had enabled 5-6 rules woke up with thousands active. The same cron passed `autoCreateAlerts: true`, which inserted an `alert_rules` row per synced Sigma rule, so Sigma rules appeared to "turn into" alert rules overnight. The cron now syncs only the rules the org already imported (by `sigmahq_path`) to refresh their detection content, and never auto-creates alert rules; Sigma rules stay independent. (Does not retroactively clean rules/alerts already created; a one-off cleanup is tracked separately)
- **Log Context dialog no longer overflows on wide content**: a wide metadata `<pre>` or breadcrumb entry stretched the whole dialog (the grid children had `min-width: auto`); the content now stays within the dialog and the wide block scrolls on its own axis
- **Sigma compound field-modifier chains were silently truncated**: the matcher split a field key like `CommandLine|utf16le|base64offset|contains` on `|` but kept only the first modifier, so any rule using a transform-plus-comparator chain (or a PowerShell `-enc` style `utf16le|base64offset|contains`) matched incorrectly. The whole chain is now parsed and applied in order: transforms (`base64`, `base64offset`, `utf16le`/`utf16`/`utf16be`/`wide`, `windash`) rewrite the pattern, then the final comparator runs. Transforms follow the canonical SigmaHQ model (the pattern is encoded, e.g. the field is checked for `base64(value)`), which is what real SigmaHQ rules are authored against. Added `cidr` and numeric `gt`/`gte`/`lt`/`lte` comparators while reworking the parser
- **Sigma `|all` modifier had the wrong semantics**: it was implemented as "all whitespace-split words present in any order" rather than the SigmaHQ list quantifier. `|all` now flips the default OR over a value list into AND (every list element must match), and composes with modifier chains (e.g. `cmd|base64|contains|all`)

### Changed
- **Project overview now shows an Activity Overview instead of a logs-only timeline**: the project overview page (`/dashboard/projects/:id/overview`) replaced the "Logs Timeline (Last 24 Hours)" chart (log levels only) with the multi-signal Activity Overview, plotting logs, log errors, spans, span errors, detections and alerts over the same 24h window (toggle individual series from the legend). It reuses the existing custom-dashboard `activity_overview` fetcher via a new `GET /api/v1/dashboard/activity-overview` endpoint (org-membership + project-in-org scoped); no new storage or migration
- **Service-map p95 is now a true window percentile across all engines**: the service dependency map previously reported `MAX(duration_p95_ms)` from the per-bucket spans continuous aggregate, which overestimates (a p95 is not derivable by combining per-bucket p95s) and was only ever produced on TimescaleDB. Per-service health stats now come from a new `reservoir.getServiceHealthStats` computed directly from raw spans over the requested window on every engine: `percentile_cont` on TimescaleDB, `quantile(0.95)` on ClickHouse, and `$percentile` on MongoDB (approximate t-digest, Mongo 7.0+). ClickHouse and MongoDB service maps now carry real call/error/latency/p95 figures where they previously had none. The `spans_hourly_stats` / `spans_daily_stats` aggregates are unchanged and still back the dashboards
- **Trace and session IDs in the log search detail are theme-aware**: the expanded log row rendered them as hardcoded light-mode pills (`bg-purple-100` / `bg-teal-100`) that looked washed out in dark mode. The trace ID is now a link that opens the trace timeline (primary accent) with a separate filter button, and the session ID is a dark-safe filter button; both derive their colors from the design tokens

## [1.0.2] - 2026-06-22

A frontend correctness and security release from a comprehensive multi-agent frontend bug hunt (UI, logic, reactivity, leaks and security), plus a hardening of how the browser authenticates the live-streaming endpoints. The headline item is single-use stream tickets: the session token no longer travels in WebSocket/SSE URLs (where reverse proxies log it). One additive database migration (`049_stream_tickets`); otherwise a drop-in upgrade.

### Security
- **Session token no longer placed in WebSocket/SSE URLs**: browser `WebSocket` and `EventSource` cannot send an `Authorization` header, so the log live-tail (`/api/v1/logs/ws`), the SIEM events stream (`/api/v1/siem/events`) and the trace live-tail (`/api/v1/traces/stream`) previously carried the long-lived session token in the URL query string, where it is logged by proxies and servers. The client now mints a short-lived, single-use **stream ticket** via an authenticated `POST /api/v1/stream-tickets` and passes that ticket instead. Tickets live in the relational database (not Redis, so the mechanism is portable across the BullMQ and graphile queue backends), expire in 30s and are consumed on first use. The legacy `?token=` path still works for backward compatibility
- **Webhook channel secrets no longer rehydrated into the DOM**: editing a notification channel no longer pre-fills the bearer token / basic-auth password inputs with the stored secret; the fields stay empty with a "leave blank to keep current" hint and are only sent when the user types a new value
- **OIDC callback strips the session token from the URL** after reading it, so it no longer lingers in browser history, the referrer or logs
- **Admin pages enforce a client-side admin guard**: several admin views (user detail, usage, organization detail) loaded and could mutate data on mount without checking the admin role; they now redirect non-admins, and the admin section layout has a guard of its own
- **Removed a debug `console.log`** that leaked log message content and api-key metadata to the browser console on the error-detail page

### Added
- **Global 401 handler**: a single fetch interceptor installed at app startup clears local auth state and redirects to the login page (preserving the current path so the user lands back there after signing in) on any authenticated `/api/v1` 401 that is not an auth endpoint. Previously a revoked or expired session was only detected on a full dashboard remount, so a logged-out user could keep clicking around getting silent failures
- **`POST /api/v1/stream-tickets`** endpoint and `stream_tickets` table (migration 049) backing the stream-ticket auth described above

### Fixed
- **Stale-response races**: overlapping loads triggered by fast filter/pagination changes could let an older in-flight response overwrite fresher results. Added local request-sequence guards on the log search, traces list, error groups, SIEM incidents, monitor detail/list, custom-dashboard panels and alert-preview views
- **API client error handling**: error-branch `response.json()` calls are guarded so a non-JSON error body (reverse-proxy 502/HTML, empty `204`) no longer throws a `SyntaxError` that masks the real HTTP failure (auth, admin and exceptions clients)
- **Locale-stable formatting**: user-facing dates and numbers now use explicit `en-US` formatting across the status pages, members, project settings, traces, metrics, search and notification-channel views; alert-history timestamps no longer label UTC values as if they were local time
- **Lifecycle and memory leaks**: component store subscriptions are auto-managed, a first-run shortcut-hint `setTimeout` is cleared on unmount, and chart instances are disposed, so navigating away no longer leaves timers, listeners or subscriptions behind
- **Svelte 5 reactivity and assorted UI fixes**: the trace detail page reloads when navigating between traces; the api-key DSN preserves an `http://` scheme for non-TLS deployments; the "View Error Group" action navigates with a param the target page actually reads; SigmaSync no longer crashes when a commit hash is absent; the toaster follows the app theme; the delete-organization confirm is disabled while in flight; PII masking rules require a regex or field names; numeric monitor inputs guard against `NaN`; and the audit-log resource cell no longer renders a literal escape sequence
- **ClickHouse**: materialized-view backfills now run once instead of on every startup

### Notes
- Left intentionally unchanged: storing the session token in `localStorage` (a disputed, low-severity finding). Moving it to an httpOnly cookie would trade XSS token-theft for CSRF surface and a full auth-model overhaul without a clear net win; the high-leverage XSS defenses (CSP, output sanitization, auditing the few `{@html}` sites) are tracked separately

## [1.0.1] - 2026-06-19

A security and correctness release from a comprehensive, multi-engine bug audit of the 1.0 line. The headline items are two cross-tenant data-exposure fixes that were live in 1.0.0, alongside a broad sweep of detection, ingestion, storage, alerting and frontend correctness fixes. No database migrations; this is a drop-in upgrade. The storage-layer fixes were validated against real ClickHouse and MongoDB (and TimescaleDB), and CI now runs the MongoDB reservoir integration suite.

### Security
- **Cross-tenant log exposure via the WebSocket live-tail** (`GET /api/v1/logs/ws`): the handler validated only the session token and then streamed whatever `projectId` the client passed, never checking project/organization membership, so any authenticated user could live-tail any project's logs by supplying its id. It now enforces the same `verifyProjectAccess` membership check as the REST query routes (regression test added). Was live on the 1.0.0 line
- **Cross-tenant leak of notification-channel secrets**: `GET /notification-channels/alert-rules/:id` and `/sigma-rules/:id` returned the channel `config` verbatim (including webhook `auth` tokens/passwords) with no membership check. They now resolve the rule's organization, require membership, and scope the read to that org
- **PII masking fail-open**: `maskText` skipped all content rules for pure-alphanumeric strings, so a separator-less credit-card number (e.g. `4111111111111111`) was stored unmasked. The all-alphanumeric early-exit is removed; only too-short strings are skipped
- **OIDC account-takeover**: linking an external identity to an existing local account by email now requires the provider to assert the email is verified (`email_verified === true`), preventing takeover via an unverified IdP email; LDAP is treated as authoritative
- **Cross-tenant `?projectId` / association gaps** closed: the correlation batch-identifiers endpoint now intersects the requested project with the caller's accessible projects (and requires read access); status-incident and scheduled-maintenance creation, organization-default channels, and alert/sigma/monitor channel associations now validate that the project/channels belong to the caller's organization
- **Session invalidation**: disabling a user, resetting their password, and changing a user's admin role now invalidate the cached session (previously the cached profile stayed valid for up to the cache TTL); the frontend logout now revokes the server-side session token instead of only clearing local state
- **Hardening**: emails are stored and compared case-insensitively across registration/login/profile-update; the global `CACHE_TTL` override no longer clamps semantic TTLs (sessions, OIDC state, settings); the webhook envelope id is validated as a UUID; SigmaHQ category sync matches on a directory boundary; OTLP trace/span ids of invalid length are rejected

### Security
- **Dependency security updates, third wave** (Dependabot): two further advisories resolved to their patched releases. The direct dependency `nodemailer` is bumped from `^8.0.9` to `^9.0.1` (GHSA-p6gq-j5cr-w38f, HIGH): the message-level `raw` option bypassed `disableFileAccess`/`disableUrlAccess`, enabling arbitrary file read and full-response SSRF in the delivered message; our SMTP senders only use standard `createTransport`/`sendMail` fields and never pass `raw`, but the dependency is patched regardless. The transitive `undici` (pulled in only by `jsdom` in the frontend test toolchain) is pinned via the root pnpm `overrides` to `>=7.28.0 <8` (GHSA-vmh5-mc38-953g HIGH, TLS certificate validation bypass via dropped `requestTls` in the SOCKS5 `ProxyAgent`; GHSA-pr7r-676h-xcf6 MEDIUM, cross-user information disclosure via shared-cache whitespace bypass), resolving to `7.28.0` and staying on the 7.x line `jsdom@29` expects. No vulnerable version remains in `pnpm-lock.yaml`

### Fixed
- **ClickHouse "Query with id = ... is already running" under concurrent queries** (#213 regression): the request-context propagation derived the ClickHouse `query_id` deterministically from `requestId + operation`, so two same-operation queries running concurrently within one request reused the same id and ClickHouse rejected the second. The `query_id` now keeps the request id + operation as a readable prefix (correlation is also carried in the SQL `log_comment`) and appends a random suffix so every query is unique. ClickHouse-only
- **Sigma condition operator precedence**: `parseExpression` folded AND/OR strictly left-to-right, so `a or b and c` evaluated as `(a or b) and c`. AND now binds tighter than OR, matching the Sigma spec
- **Infinite loop on ingestion**: a custom identifier pattern that can match the empty string (e.g. `\d*`) no longer hangs the worker (zero-width-match guard plus a forced global flag)
- **Trace summary races**: `upsertTrace` is now race-free on TimescaleDB (single atomic `INSERT ... ON CONFLICT`) and ClickHouse (the summary is recomputed from the spans table instead of read-modify-write), so concurrent span batches no longer lose span counts
- **ClickHouse**: added the missing `session_id` column (was written and filtered on but did not exist), parse zone-less datetimes as UTC, report the true latest value in the metrics overview (was the average) with NaN guards
- **MongoDB**: `deleteMetricsByTimeRange` only deletes the matched metrics' exemplars (was all exemplars in the window); the metrics overview sorts before `$last`; metadata `distinct` no longer drops numeric/boolean values; `ingestReturning` returns the rows that did land on a partial bulk-write failure
- **Rate-of-change alerts**: the baseline now applies the rule's metadata filters (previously only the current rate did, deflating the deviation ratio), and a `minBaselineValue` of 0 is honored instead of defaulting to 10
- **Dashboards**: personal dashboards are scoped to their creator (no longer readable/editable by any org member); `metric_stat` sums across buckets for sum/count aggregations; top-error percentages are computed against the true total; the capability usage page renders a zero limit as fully restricted, not unlimited
- **Pagination/counts**: admin organization/project search counts apply the search filter; correlation lookups report the true total; the ClickHouse trace error-rate uses a consistent denominator; `getTopServices` honors the `to` bound
- **Live tail**: SSE polling bypasses the 60s query cache and guards against overlapping polls; the live-tail WebSocket URL works behind a reverse proxy; the traces and search live tails no longer corrupt pagination or index-keyed row state
- **Infra/correctness**: BullMQ and graphile queue retry-attempt defaults are aligned; webhook deliveries can only be replayed from the terminal `dead` state (no double delivery); the audit flush buffer is bounded on persistent DB failure; alert-notification jobs are deduplicated by history id; admin org-role changes are restricted consistently with member removal; tenant-table updates in the log-pipeline and service-dependency queries are project-scoped

### Changed
- The reservoir storage abstraction gains `getTraceServices` (distinct trace services with no result cap) implemented on all three engines and used by the traces service, replacing the previous 10k-trace paging
- CI now provisions a MongoDB service for the reservoir integration suite, so all three storage engines are exercised on every run

### Notes
- Deferred to a follow-up (#255): Sigma compound field modifiers (`field|base64|contains` chains) and a true service-map p95 (needs a mergeable t-digest sketch in the continuous aggregate)

## [1.0.0-beta] - 2026-06-16

First beta of the 1.0 line. The headline work since 0.9.7 is the **tenant data isolation audit** that hardens every backend data-access path before the 1.0 stable cut, and the **metering + capability system** pair (#212, #214) that gives every organization usage measurement, feature gates and enforceable limits/quotas (ingestion, spans, storage) - the foundation for plan tiers without changing OSS behavior. A typed **lifecycle hooks** extension surface (#216) lands alongside it, letting operators observe, mutate or reject ingestion, query, alert-evaluation and webhook-dispatch without forking. A reusable **outbound webhook delivery** system (#218) also lands - HMAC signing, retry with backoff, a dead-letter queue and centralized SSRF protection - onto which every existing webhook sender is migrated, closing three unguarded `fetch` paths in the process. Two infrastructure features landed on the way there: end-to-end request-context propagation, and the groundwork for scheduled email digests (merged but disabled in this beta, see #154).

### Security
- **PII masking is now fail-closed at ingestion**: previously, if the masking step threw (rule compilation failure, malformed rule at evaluation time), the batch was stored **unmasked** with only a `console.warn` - silently violating the masking guarantee. `maskLogBatch` now reports per-record failures and the ingestion service rejects exactly those records before the reservoir write (whole batch if rule compilation itself fails); rejected records are reported back to the client in a new optional `rejected: [{ index, reason: 'pii_masking_failed' }]` field on the ingest response (`received` keeps its meaning; the field is omitted when empty, so existing clients are unaffected) and as `partialSuccess.rejectedLogRecords` on the OTLP logs endpoint. Every rejection increments an `ingestion.pii_rejected` metering counter and emits an internal platform log (no log content included). No unmasked data can reach any storage engine through `ingestLogs`
- **Cross-tenant log reads via unvalidated `?projectId` on the logs query API (authenticated)** (#228, audit #219): all 10 endpoints in `modules/query/routes.ts` accepted a `?projectId=` URL parameter and queried with it directly, without verifying it belonged to the authenticated API key's bound project. Because project UUIDs appear in dashboard URLs and client API calls, any valid API key could read **any** project's (and therefore any organization's) logs simply by passing a different `projectId`. Fixed with a shared `resolveQueryProjectId(request, reply, queryProjectId)` guard in `modules/auth/guards.ts` that returns `403` when the requested projectId does not match the key's project; session auth keeps using `verifyProjectAccess` (org-wide by current policy). Locked by `src/tests/isolation/query-isolation.test.ts`. The reported leak was present on the main line
- **Cross-tenant trace/span reads via the same pattern on the traces query API (authenticated)** (#228): the identical unvalidated-`projectId` flaw existed on 8 trace/span read endpoints in `modules/traces/routes.ts`, allowing cross-tenant trace and span reads. Fixed with the same `resolveQueryProjectId` guard and locked by `src/tests/isolation/traces-isolation.test.ts`. The metrics query API was already safe (it resolves the projectId from the key for API-key auth) and was not vulnerable
- **Application-layer scoping gaps on tenant-table queries (defense in depth)** (#228): a sweep of every tenant-table access path closed several queries that were missing an `organization_id` / `project_id` filter even though the surrounding route checked org membership: `pii-masking/service.ts updateRule` (pre-read SELECT now org-scoped), `siem/service.ts` `linkDetectionEventsToIncident` / `getIncidentDetections` / `enrichIncidentIpData` (now require and apply `organizationId`), `exceptions/service.ts` `getExceptionByLogId` / `getExceptionById` / `updateErrorGroupStatus` (now org-scoped, redundant post-read route checks removed), and `correlation/service.ts getLogIdentifiers` (now project-scoped). Session-auth routes across alerts, detection-packs, notification-channels, projects, correlation and pii-masking now Zod-validate `organizationId` as a uuid instead of a raw cast, and the `custom-dashboards` personal-dashboard filter moved from in-memory into the SQL `WHERE`
- **Dependency security updates ahead of the 1.0 cut**: three flagged advisories in the dev/build toolchain are resolved by upgrading to their patched releases - `vitest` and `@vitest/coverage-v8` to `3.2.6` (GHSA on the Vitest UI server allowing arbitrary file read/exec), and the transitive `esbuild` (>= `0.28.1`) and `shell-quote` (>= `1.8.4`) pins bumped via the root pnpm `overrides` (esbuild Deno binary-integrity RCE; shell-quote newline-escaping). No vulnerable version remains in `pnpm-lock.yaml`. Supersedes the open Dependabot PRs
- **Dependency security updates, second wave**: a further batch of advisories surfaced right after the cut, all resolved to their patched releases. Direct dependencies bumped: `nodemailer` to `>= 8.0.9` (TLS certificate validation in OAuth2 token fetch, `List-*` header CRLF injection, and `jsonTransport` file/url access bypass), `vite` to `>= 6.4.3` (`server.fs.deny` bypass on Windows alternate paths plus the bundled `launch-editor` NTLMv2 hash disclosure), `js-yaml` to `>= 4.2.0` (quadratic-complexity DoS in merge-key handling), and `protobufjs` to `>= 7.6.3` (schema-derived names shadowing runtime properties). Transitive pins added/raised via the root pnpm `overrides`: `form-data` (`>= 4.0.6`, multipart field-name CRLF injection), `@opentelemetry/core` (`>= 2.8.0`, unbounded memory in W3C Baggage propagation) and `vite` (forced repo-wide so no `6.4.2` lingers transitively). No vulnerable version remains in `pnpm-lock.yaml`

### Added
- **Capability usage vs plan limits on the usage page**: the settings usage page gains a "Plan limits" section that shows current consumption against each configured capability limit as a progress bar. A new `GET /api/v1/usage/capabilities` endpoint (`packages/backend/src/modules/metering/capability-usage.ts`) joins live usage to the configured cap for every measurable capability: resource counters (`alerts.max_rules`, `notifications.max_channels`, `apikeys.max`, `sigma.max_active_rules`, `dashboards.max_custom`) reuse the same COUNT logic as enforcement (so API-key counts still join through projects), and consumption quotas (`ingestion.max_events_monthly`, `ingestion.max_bytes_monthly`, `storage.max_bytes`, `tracing.max_spans_monthly`) reuse the QuotaEvaluator's month-to-date / latest-snapshot semantics. Boolean gates and `audit.retention_days` (a config ceiling, not a usage reading) are excluded. Bars are color-coded (green < 80%, amber 80-99%, red >= 100%) and a null limit renders as "Unlimited" rather than a percentage, so OSS defaults read correctly
- **Audit log primitive: typed actions, actor types, outcomes and per-org retention** (#217): the audit log grows from a free-string event sink into a structured security primitive. A canonical action registry (`packages/backend/src/modules/audit-log/actions.ts`, 70 actions across 13 families like `org.*`, `apikey.*`, `rule.*`, `auth.*`, `data.*`) is now the single source of truth: actions are a TypeScript string-literal union so typos fail to compile, and the audit category is derived from the registry instead of being hand-passed at every callsite. A new `auditLogService.record()` API reads organization, actor (user/apiKey/system), IP and user agent from the request context (`@logtide/shared/context`) so callsites only state the action and target; it supports recording atomically inside a caller's transaction (`{trx}`), awaited fire-and-safe inserts that never fail the request (default), and the existing flush buffer for high-volume access logging (`{buffered}`). All 57 legacy `log()` callsites across 15 modules were converted and the legacy API deleted; new coverage lands for notification channels, custom dashboards, log pipelines, webhook delivery replay, the invitation lifecycle, profile updates and, notably, failed local logins (`auth.login_failed` with `outcome: 'failure'`, previously not recorded at all). Migration 048 adds nullable `actor_type`/`actor_id`/`outcome` columns to the compressed `audit_log` hypertable (additive only; legacy rows are normalized at read time via COALESCE, so old data filters correctly as user/success). The query API and CSV export gain `actorType` and `outcome` filters and the new columns; `GET /audit-log/actions` returns the full typed catalog plus historical names. Because actors now come from the request context, API-key access to query endpoints is audited too (previously only session users were). Per-org audit retention: `organizations.audit_retention_days` (1-3650 days, NULL = keep forever, the default) is editable from the admin organization page next to log retention, audited as `org.retention_updated`, and enforced by a daily cleanup that runs with the existing 2 AM retention job. The audit page in settings gains actor-type, outcome and time-range filters plus actor/outcome badges in the table
- **Test debt paid down (WS5)**: the six backend coverage exclusions are gone: `query/websocket.ts`, `monitoring/checker.ts`, `custom-dashboards/panel-data-service.ts` (all 13 panel fetchers, integration style), `sigma/sync-service.ts`, `siem/geolite2-service.ts` and `siem/ipsum-service.ts` are now tested and counted with the 80% thresholds still enforced. The 12 previously untested `@logtide/shared` Zod schemas (including `logSchema`, `ingestRequestSchema`, `alertRuleSchema`) gain dedicated tests, CI now runs the shared and frontend unit suites alongside the backend, and frontend component testing is enabled (Svelte 5 + testing-library) with first coverage on the critical SIEM and identifier badge components
- **Frontend unit test harness + traces E2E journey** (WS4 gap closure): vitest is now wired in `packages/frontend` (first tests cover the extracted `lib/utils/trace-tree.ts` span waterfall logic), the trace detail span panel gains a span id copy button, and a dedicated Playwright journey (`tests/traces.spec.ts`) covers the trace list, service/error filters, waterfall expand/collapse, span panel and the bidirectional trace/log correlation, seeding real spans through the OTLP traces endpoint
- **after-* lifecycle hook phases** (#216 follow-up): `afterIngest` (batch counts and rejection reasons, no log content), `afterAlertTriggered` (post-persist trigger facts for both threshold and rate-of-change paths) and `afterWebhookDispatch` (per delivery attempt result, queued and sync paths alike). Fire-and-forget semantics: handler errors are logged and never block or mutate the operation, contexts are frozen read-only snapshots, and `hasHandlers` guards keep the no-handler hot path at zero overhead. Registered via the same `HOOKS_MODULES` mechanism as the before-* phases; documented in `docs/lifecycle-hooks.md`
- **Capability enforcement completed across resource creation** (#214 follow-up): the previously defined but unenforced `notifications.max_channels` and `apikeys.max` limits are now enforced at channel/key creation (API keys counted org-wide across all projects of the organization), and two new limit keys land with enforcement: `sigma.max_active_rules` (checked on rule enable, single import, and SigmaHQ sync, where the whole batch is pre-checked so a partial sync never applies) and `dashboards.max_custom` (dashboard creation, personal dashboards included in the count). All defaults stay unlimited for self-hosted OSS; per-org caps are set in the admin entitlements editor, which picks the new keys up automatically since it enumerates the registry. `assertWithinLimit` gains an `adding` parameter for bulk pre-checks, with a `(current+adding/limit)` error message for bulk violations
- **Ingestion health visibility for admins**: a new instance-admin endpoint `GET /api/v1/admin/stats/ingestion-health` aggregates the last 24h of the new ingestion health counters (`ingestion.pii_rejected`, `ingestion.detection_enqueue_failed`, `ingestion.exception_enqueue_failed`, `ingestion.identifier_failed`, recorded as non-billed `metering_events`) plus SIEM enrichment availability (GeoLite2/IPsum status), surfaced as an "Ingestion health (24h)" card on the admin dashboard that highlights in red when failures occurred. Sigma-detection and exception-parsing job enqueues now retry once on failure and, if the retry also fails, record the counter and an internal error log instead of failing silently - for a SIEM a silently dropped detection job is fail-open, so it must be loud
- **Tenant isolation audit, test suite and CI tripwires** (#228, #219): a living audit document at `docs/security/tenant-isolation-audit.md` (tenancy model, table taxonomy, per-path inventory, findings, contributor checklist), a dedicated isolation test suite at `packages/backend/src/tests/isolation/` (the `createIsolatedTenants` fixture plus per-area tests for query, traces, crud, api-key auth, audit-log, metering and the current org-wide-session policy) that runs in CI, a static tripwire `scripts/check-tenant-scoping.ts` (npm `check:tenant-scoping` / `report:tenant-scoping`) that flags Kysely queries on tenant tables lacking org/project scoping and fails the CI typecheck job on new unscoped sites, with known-OK exceptions content-keyed in `scripts/tenant-scope-allowlist.json`, an opt-in runtime Kysely guard `database/tenant-scope-guard.ts` (`TENANT_GUARD=1`) for targeted audit runs, and a `.github/pull_request_template.md` carrying a tenant-safety checklist. The codified model: organization is a hard boundary for everyone, API keys are project-scoped, session users are org-wide by current policy (per-project RBAC is a documented future extension point, not yet enforced)
- **Scheduled email digest reports - groundwork, disabled** (#209, part of #154): the foundation for periodic email summaries of log activity. **This feature is intentionally disabled in 1.0.0-beta**: it is still incomplete (only log volume is summarized - no error groups, security or uptime sections, no HTML layout - and there is no UI to configure it), so the worker leaves the scheduler unregistered and no digests are sent. The service, schema and tests are merged so the remaining scope can be finished under #154. What landed: New `digest_configs` table (one per organization: daily/weekly frequency, delivery hour `0-23`, `delivery_day_of_week` required for weekly, enabled flag, with CHECK constraints enforcing all of it) and `digest_recipients` table (per-recipient subscription state with a 32-byte URL-safe opaque `unsubscribe_token`, supporting both internal users via `user_id ON DELETE SET NULL` and external email-only recipients). A new `ICronRegistry` abstraction on the queue layer (`registerCronJobs`, called once at worker startup) with native-cron implementations for both BullMQ (`repeat.cron`) and Graphile (`parsedCronItemsFromCrontab`); a `DigestScheduler` that reads active configs at boot and registers stable `digest:{organizationId}` cron jobs (so restarts don't duplicate schedules); and a `DigestGeneratorService` that computes log volume from the `logs_hourly_stats` continuous aggregate, derives a period-over-period trend (`+3,000 (+25.0%)`, `+5,000 (new activity)`, `no change`), sends a "quiet period" message for empty orgs rather than skipping, and reuses the existing nodemailer SMTP path with a unique unsubscribe link per recipient
- **Request context propagation across HTTP, jobs and the DB layer** (#222, closes #213): a new AsyncLocalStorage-backed `RequestContext` primitive in `@logtide/shared/context` (with `run` / `enterWith` / `with` / `runAsSystem`, serialize/deserialize for queue payloads, and a `fetchWithContext` helper that injects `X-Logtide-Request-Id` on outbound HTTP). A Fastify plugin establishes the context right after auth resolves (org, project, user/apiKey, requestId, ip, ua); BullMQ producers transparently piggy-back `_ctx` on payloads and consumers wrap processors in `context.run` / `runAsSystem`, and 7 cron callbacks run under `runAsSystem('cron:<name>')`. The backend `pg.Pool.query` and `pool.connect()` are patched to prepend a `/* req=... */` SQL comment so requests are traceable in slow-query logs and `pg_stat_activity`, and each reservoir engine injects the same correlation in its native form (Timescale SQL comment, ClickHouse `query_id` + `log_comment`, MongoDB `$comment`). `@logtide/shared` exposes the public context API and a `@logtide/shared/context` subpath
- **Migration 044 `digest_email_reports`**: creates the `digest_configs` and `digest_recipients` tables and their lookup indexes (see the digest feature above). Numbered 044 after the prefix-collision fix below
- **Resource usage metering per organization and project** (#212): a storage-agnostic way to record and aggregate consumption, surfaced as a "Usage" section in the dashboard. A new `metering_events` TimescaleDB hypertable (on the control-plane DB) is fed by a non-blocking, loss-tolerant in-process `MeteringRecorder` that buffers `metering.record(...)` calls and batch-inserts on a size threshold, a flush interval, and on graceful shutdown - dropping under back-pressure rather than blocking the request path, since metering is measurement not audit. The first recording site is log ingestion, which records `logs.ingested.bytes` and `logs.ingested.events` fire-and-forget after `reservoir.ingestReturning()` (so OTLP log ingestion is metered too, guarded by `organizationId`). `MeteringService.aggregate` does query-time grouping by type, project or UTC-day (no continuous aggregates, since metering is one low-volume row per batch), always organization-scoped. Read APIs: `GET /api/v1/usage` (membership-guarded, grouped totals/series) and `GET /api/v1/usage/breakdown`, which answers "what is being ingested" by metering type, by project (with the project name resolved), and - through the reservoir abstraction so it works on any storage engine - by service and by log level. Frontend: a Usage page under Settings for org members plus a read-only admin view with an organization picker, each showing totals, a daily series, and the by-type / by-project / by-service / by-level breakdowns. Tunable via `METERING_ENABLED`, `METERING_FLUSH_INTERVAL_MS` and `METERING_FLUSH_MAX_BUFFER`. Deliberately deferred to follow-ups: TimescaleDB continuous-aggregate optimization, the `spans.ingested` / `metrics.cardinality` recording sites, and the per-project `storage.snapshot` site (the reservoir exposes no per-project byte stats today). Quota enforcement is not part of this work and lands with the capability system (#214)
- **Migration 045 `metering_events`**: creates the `metering_events` hypertable (columns `time`, `organization_id`, `project_id`, `type`, `quantity`, `metadata`) plus its `(organization_id, type, time)` and `(organization_id, project_id, time)` indexes
- **Capability system: per-organization feature gates, static limits and usage quotas** (#214): a typed capability registry (`packages/backend/src/capabilities/registry.ts`) is the single source of truth for 12 initial capabilities across three kinds - boolean gates (`auth.sso`, `detection.advanced`, `audit.enabled`, `isolation.dedicated`), static numeric limits (`alerts.max_rules`, `notifications.max_channels`, `apikeys.max`, `audit.retention_days`) and metered usage quotas (`ingestion.max_bytes_monthly`, `ingestion.max_events_monthly`, `storage.max_bytes`, `tracing.max_spans_monthly`). All defaults are OSS-permissive (booleans enabled, limits/quotas unlimited), so self-hosted behavior is unchanged until an operator sets a cap. Per-org overrides live in the new key-value `organization_entitlements` table (migration 046); a cache-backed `DbCapabilityResolver` (5-min defensive TTL, fail-open on DB errors, invalidated on admin writes) merges rows over registry defaults and is swappable via `setCapabilityResolver` so a hosted distribution can source entitlements from subscription state without patching core. Enforcement: `assertCapability` (403 `CapabilityError`), `assertWithinLimit` (403, wired into alert-rule creation as the first real consumer) and `assertWithinUsageQuota` (429 `QuotaExceededError`, hard-blocks log ingestion and OTLP span ingestion). Usage quotas are joined to #212 metering by a periodic in-process `QuotaEvaluator` (configurable via `QUOTA_EVALUATOR_ENABLED` / `QUOTA_EVALUATOR_INTERVAL_MS`, default 60s) that reads month-to-date `MeteringService.aggregate` totals for orgs with at least one non-null quota cap and maintains an in-memory over-quota flag cache, so the ingestion hot path never touches the DB for quota checks; enforcement short-circuits on a null (unlimited) limit, which doubles as the stale-flag defense when an admin lifts a cap. The global error handler now surfaces a machine-readable `code` (e.g. `capability.alerts.max_rules.limit_reached`) on 4xx responses. Read API `GET /api/v1/capabilities` returns the merged set for members (UI gating); admin `GET`/`PUT /api/v1/admin/organizations/:id/entitlements` manage per-org overrides with registry-shape validation and audit logging, surfaced in a new "Entitlements" card on the admin organization page (boolean switches + numeric caps, empty = unlimited). Known limitations: `storage.max_bytes` and `tracing.max_spans_monthly` are wired end-to-end but never trip until #212 adds the deferred `storage.snapshot` and `spans.ingested` recording sites; `limit_value` is INTEGER (caps byte quotas at ~2.1 GB, BIGINT follow-up tracked)
- **Span and storage metering recording sites** (#212 follow-up): span ingestion now records `spans.ingested` (count, fire-and-forget after the reservoir write), which activates the `tracing.max_spans_monthly` quota end-to-end. A new daily `StorageSnapshotJob` (config `STORAGE_SNAPSHOT_ENABLED` / `STORAGE_SNAPSHOT_INTERVAL_MS`, default 24h) records a persisted `storage.snapshot` event per (organization, project) estimating stored bytes as the *logical bytes ingested within the organization's `retention_days` window* - engine-agnostic by design (never scans the reservoir; ignores compression and manual deletions), which activates `storage.max_bytes`. The capability quota evaluator now reads `point_in_time` quotas from the LATEST snapshot per project (new `MeteringService.latestPointInTime`) instead of summing snapshot history. Usage pages (member + admin) gain a "Current storage (estimated)" stat and a daily storage trend (new `GET /api/v1/usage/storage`); the gauge is excluded from the summed byType breakdown. Estimate caveat: organizations with pre-metering data under-estimate storage until `retention_days` of metering history accumulates (self-healing, typically 90 days)
- **Lifecycle hooks at ingestion, query, alert evaluation and webhook dispatch** (#216): a small, typed set of named extension points (`beforeIngest`, `beforeQuery`, `beforeAlertEvaluation`, `beforeWebhookDispatch`) in `packages/backend/src/hooks/`, no-op in OSS (nothing registered by default, a `hasHandlers` guard keeps the hot paths at zero overhead). Handlers run sequentially in registration order, receive a typed per-phase context (`HookContextMap`) with documented mutable fields (ingest `records` - with automatic realignment of downstream consumers when records are filtered, query `params` - which drive the cache key, webhook `headers`/`body` - while `url` stays readonly so SSRF-validated config can't be sidestepped), and may abort the operation by throwing `HookRejectionError(code, message, statusCode)`, surfaced by the global error handler like capability errors; unexpected hook errors fail closed (HTTP 500, original error chained via `Error.cause` in server logs; the global error handler strips all internal detail from 5xx so the client receives `{ statusCode: 500, error: 'Internal Server Error' }` with no code field), except in the alert loop where a failing hook skips only that rule and the batch continues. Both webhook paths (notification channels and the legacy alert `webhook_url`) are covered. Operators register handlers without forking via `HOOKS_MODULES` (comma-separated module paths default-exporting `(hooks, helpers) => void`, loaded at boot on server and worker, fatal on load failure); external `.mjs` modules receive `{ HookRejectionError }` as the second argument so they can produce clean 4xx rejections without importing backend internals - the loader passes the same class reference the registry uses for its `instanceof` check, so external modules can throw `new HookRejectionError(code, message, statusCode)` and get the intended 4xx rather than a generic 500; observe/mutate use cases that never throw are unaffected. Downstream distributions can also call `hooks.register()` in their own bootstrap with a direct `HookRejectionError` import. Contract documented in `docs/lifecycle-hooks.md`
- **Generic outbound webhook delivery infrastructure** (#218): a reusable `webhookDispatcher` (`packages/backend/src/modules/webhooks/`) that centralizes every outbound HTTP delivery behind one well-tested module instead of scattering retry/signing/SSRF logic per feature. Capabilities: optional **HMAC-SHA256 signing** (`X-Logtide-Signature: t=<unix>,v1=<hex>` over `<unix>.<body>` plus `X-Logtide-Timestamp`, timing-safe to verify, receiver snippet in `docs/webhooks.md`); **retry with exponential backoff** (`1s, 5s, 25s, 2m, 10m`, capped by `WEBHOOK_MAX_ATTEMPTS`, transient-only - network/timeout/5xx/429 - while other 4xx and SSRF blocks are terminal); a **dead-letter queue** modeled as `webhook_deliveries.status='dead'` rather than a separate table, listable and replayable from the dashboard; **SSRF protection** by reusing the existing `safeFetch` guard through a shared single-attempt `deliverOnce` primitive (which also runs the #216 `beforeWebhookDispatch` hook *before* serializing and signing the body, so hook header/body mutations reach the wire and are covered by the signature); **per-organization concurrency limiting** via an in-process semaphore plus a global cap (`WEBHOOK_PER_ORG_CONCURRENCY` / `WEBHOOK_GLOBAL_CONCURRENCY`, no new infrastructure); and a **bounded delivery log** (`WEBHOOK_DELIVERY_LOG_LIMIT` attempts per delivery, default 1000) exposed via an org-scoped API (`GET /api/v1/webhooks/deliveries` with a `status` filter, `GET .../:id` with its attempt log, admin-only `POST .../:id/replay`) and a "Webhook Deliveries" page under Settings. Retries are driven by the job re-enqueueing itself with a computed delay rather than backend-native retry, so behavior is identical on both queue backends (BullMQ and graphile-worker); deterministic job ids (`webhook-<sha256(org:eventType:eventId)>`, hashed because BullMQ forbids `:` in custom job ids) deduplicate upstream double-enqueues. All five existing webhook senders were migrated onto it (alert, error, monitor, incident and the notification-channel `WebhookProvider`) with no payload change; the error/monitor/incident paths previously used a bare `fetch` with **no SSRF guard**, so this closes three sibling gaps in the same class as GHSA-7v53-pw6r-99vj. The delivery API redacts `signingSecret`/`headers` from the row metadata it returns. Deliberately deferred: cross-instance per-org concurrency (the current limiter is per-process), connection-level IP pinning in `safeFetch` (an app-wide TOCTOU hardening task), and migrating the digest reports (#155) onto the dispatcher
- **Migration 047 `webhook_deliveries`**: creates the `webhook_deliveries` table (one logical delivery per enqueue: org/event/url, `status`, `attempt_count`, `max_attempts`, `next_attempt_at`, `last_error`, `metadata`) and the `webhook_delivery_attempts` child table (one row per HTTP attempt with status code, duration, response excerpt and error), plus their lookup indexes (see the webhook dispatcher above)

### Changed
- **OTLP log metadata shape** (WS4 gap closure): resource attributes now land under `metadata.resource` instead of being spread flat (log record attributes keep the flat namespace and win collisions there, while nothing is lost: the full resource set is always preserved under `resource`), and structured log bodies (kvlist/array) keep their decoded structure under `metadata['otel.body']` alongside the stringified `message`. Logs ingested before this change keep their old metadata shape
- **BREAKING: unified webhook event envelope** (#218 follow-up): every outbound webhook delivery now serializes to one envelope `{ id: "evt_<uuid>", type, version: 1, occurredAt, organizationId, projectId, data }` instead of four bespoke payload shapes. Event types are `alert.triggered` (anomaly alerts distinguished by `data.baseline_metadata`), `incident.created`, `error.detected`, `monitor.status_changed`, plus `channel.test` for channel test deliveries; the per-type `data` payloads keep their previous snake_case fields minus `event_type`/`timestamp` (now `type`/`occurredAt` on the envelope). Envelope and per-type data Zod schemas ship in `@logtide/shared` (`webhookEnvelopeSchema`, `parseWebhookEvent`); deliveries carry a new `X-Logtide-Event-Version: 1` header; HMAC signing is unchanged and covers the serialized envelope; the envelope id doubles as the dedup eventId when callers do not pass one. Channel test deliveries now carry the channel's real organization id end to end. Documented in `docs/webhooks.md`
- **Reservoir log query params now require `projectId`** (#228): `projectId` was optional on the reservoir `QueryParams` / `CountParams` / `AggregateParams` / `DistinctParams` / `TopValuesParams`, which is what allowed an unscoped log read to compile. It is now **required**, with an explicit `GLOBAL_SCOPE` sentinel for the handful of intentional platform-wide reads (e.g. admin's cross-org log counts in `admin/service.ts`). The `logs` table is `project_id`-scoped only (it has no `organization_id` column), so this is the enforcement point for that table

### Fixed
- **Sigma search by MITRE technique/tactic/tag always 500ed**: `searchByMITRETechnique`, `searchByMITRETactic` and `searchByTag` in the SigmaHQ sync service compared the `TEXT[]` columns with a `::jsonb` cast (`operator does not exist: text[] @> jsonb`), so the two API routes calling them failed on every request since they shipped. The queries now use proper text-array containment (`@> ARRAY[...]::text[]`) and are covered by regression tests (found while paying down the WS5 coverage debt)
- **Silent failures made visible across admin and monitoring UI**: the admin version check no longer claims "up to date" when GitHub is unreachable (it now shows a muted "version check unavailable" card, both on fetch failure and on a successful response with no release data); the monitoring page no longer swallows incidents/maintenance load errors in empty `catch {}` blocks (failures now render an inline error banner in the affected tab); GeoLite2/IPsum unavailability warns once per outage instead of spamming every lookup, re-arming after a successful reload
- **Weakened `getStats` date-filter tests strengthened**: three tests carried a stale "bug in the service" comment and zero-signal assertions (`toBeGreaterThanOrEqual(0)`) that could never fail; the underlying service was long since rewritten correctly on `reservoir.topValues`, so the tests now assert exact filtered counts and would catch a regression
- **Migration prefix collision that could break production migrate** (#229): two migration pairs shared a numeric prefix. Kysely sorts migration files alphabetically and validates already-recorded migrations against the sorted file list position-by-position, so the `042_*` pair was a live failure for any database deployed between Apr 18 and Apr 21 (it recorded `042_project_data_availability` before `042_digest_email_reports` existed); the `037_*` pair worked only by luck because alphabetical order happened to match merge order. Fixed by renaming `042_digest_email_reports.sql` to `044_digest_email_reports.sql` and `037_monitor_notification_channels.sql` to `037a_monitor_notification_channels.sql`, plus an idempotent pre-migration repair (`src/database/migration-repair.ts`) that renames the matching `kysely_migration` rows on already-applied databases (bumping the 044 timestamp so kysely's `(timestamp, name)` sort matches the new file order). A new vitest CI guard rejects future duplicate numeric prefixes. Verified end-to-end on both a freshly recreated schema and a database seeded into the pre-fix state
- **`DELETE /api/v1/sigma/rules/:id` returned 500 instead of 404 for a missing or cross-org rule** (#229): the service's `'Sigma rule not found'` throw fell through to a generic 500. It now maps to `404`, and `404` was added to the route response schema (enforced by typecheck). The `PATCH` toggle already behaved correctly because `toggleSigmaRule` returns `null` rather than throwing
- **Custom-dashboard update/delete returned 500/204 instead of 404 for a missing or cross-org id** (#229): `CustomDashboardsService.update` used `executeTakeFirstOrThrow`, surfacing kysely's `NoResultError` as a 500; it now uses `executeTakeFirst` and throws an explicit `'Dashboard not found'` mapped to `404`. `CustomDashboardsService.delete` silently returned a `204` no-op for an id the caller couldn't see; it now throws `'Dashboard not found'` mapped to `404`. None of these leaked or mutated another tenant's data (the scoping already prevented the operation); this only corrects the HTTP status
- **API-key `last_used` write amplification on hot keys** (#222, bonus fix): every authenticated request updated `api_keys.last_used`, producing ~100 updates/sec on a single row under load. The update is now debounced to at most once per 60s per key, eliminating the contention on that row. Pre-existing bug surfaced during context-propagation load validation

## [0.9.7] - 2026-06-03

### Security
- **SSRF in alert/Sigma webhook delivery via the legacy delivery path (authenticated)** (GHSA-7v53-pw6r-99vj, CWE-918): the 0.9.6 SSRF hardening added the centralized `utils/ssrf-guard.ts` guard and wired it into the HTTP/TCP monitors and the `WebhookProvider`, but the actual alert/Sigma webhook *delivery* path was left on the old inline filter. `sendWebhookNotification` in `queue/jobs/alert-notification.ts` (reached by the `alert-notifications` BullMQ worker for threshold, rate-of-change and Sigma-rule alerts) still ran a bare `fetch(webhook_url, …)` guarded only by a string-based `isPrivateIP()`. That check was bypassable: any non-dotted-quad hostname returned `false` (no DNS resolution), so a domain whose A record points at `127.0.0.1` / `169.254.169.254` / an internal host passed the filter and the resolved internal address was then connected; the bare `fetch` used the default `redirect: 'follow'`, so a public host that `302`s to an internal URL was followed straight there; and CGNAT (`100.64.0.0/10`), IPv6, IPv4-mapped IPv6, `0.0.0.0/8` and `198.18.0.0/15` were not covered. An authenticated org owner/admin who can create a webhook notification channel could therefore use the backend as a blind SSRF probe against internal services and cloud metadata, with a partial read-back oracle since a non-2xx internal response body was spliced into the alert-history error message. The guarded "Test" button already blocked the same URLs, confirming this as an incomplete-fix sibling-gap. Fix: `sendWebhookNotification` now routes delivery through `safeFetch(url, init, { allowPrivate: config.MONITOR_ALLOW_PRIVATE_TARGETS })`, exactly as `WebhookProvider` does (DNS resolution + per-redirect-hop revalidation + full IPv4/IPv6 private/reserved range coverage), mapping `SsrfBlockedError` to the existing "private/internal addresses are not allowed" error. The inline `isPrivateIP`/`BLOCKED_HOSTS` filter and the bare `fetch` are removed, and blocked targets are now rejected before the response body is read (closing the read-back oracle). The `MONITOR_ALLOW_PRIVATE_TARGETS` opt-in still lets self-hosted deployments target internal endpoints. Reported by tonghuaroot

## [0.9.6] - 2026-06-01

### Changed
- **Frontend now runs as a full SPA on `adapter-node`** instead of doing SSR with client hydration. A single `export const ssr = false` in the new root `+layout.ts` cascades to every route, so the server only ships the empty app shell and the client renders from scratch. Eliminates the entire class of hydration mismatch bugs that had been accumulating across login, register, invite, public status page, the `/auth/callback` page and the various dashboard subpages, each previously patched with its own per-route `ssr = false`. Server load functions and the Node runtime are untouched (the adapter, API proxying, env vars, BullMQ etc. keep working exactly as before); there are no `+page.server.ts` / `+layout.server.ts` files in the repo today so nothing had to change semantically on the server side. UX tradeoff: the public status page at `/status/[orgSlug]/[projectSlug]` now flashes the empty shell for one paint before the JS hydrates, which is acceptable for an authenticated-by-default product but should be revisited if SEO on the status page becomes a goal (a single-line override `export const ssr = true` in that page's `+page.ts` puts it back on SSR without affecting anything else)
- **Removed 22 redundant route-level `ssr = false` declarations** (`dashboard/+layout.ts`, `dashboard/admin/+layout.ts` and 20 `+page.ts` files across landing, login, register, onboarding, invite, status, auth callback and the dashboard search / metrics / alerts / monitoring / projects / sessions / settings subtrees) that had been added one by one as each page hit a hydration bug. The new root-level cascade makes them all dead config; deleting them removes the temptation to copy the pattern into new routes

### Fixed
- **Infinite skeleton spinner on `/dashboard/search`, `/dashboard/traces` and `/dashboard/metrics`** when no project in the org had its data-availability flag set, typically right after a user deleted the only projects that had been ingesting. The filter logic at `search/+page.svelte:441-444` (and the identical pattern at `traces/+page.svelte:142-145` and `metrics/+page.svelte:90-93`) read `const logsProjectIds = availability?.logs` and then branched on `logsProjectIds ? filter : fallback`. When `getProjectDataAvailability` legitimately returned `{ logs: [] }` the empty array took the truthy branch (`[]` is truthy in JS) and `[].includes(p.id)` excluded every project, so the displayed project list was empty, `loadLogs()` never fired, and `hasLoadedOnce` stayed `false` so the `SkeletonTable` rendered forever. Fix: guard the truthy branch with `logsProjectIds && logsProjectIds.length > 0` so an empty availability response falls back to "show all projects" exactly like the API-failure path (`.catch(() => null)`) already does. The 0.9.4 backend optimization that introduced the cached availability flags is unaffected; this is purely a frontend null-vs-empty conflation. Logs of already-hard-deleted projects on the TimescaleDB engine remain unrecoverable due to `ON DELETE CASCADE` on `logs.project_id` (tracked separately under the soft-delete projects epic)
- **OIDC login failed against issuer-identifying providers (e.g. Authelia) because the `iss` callback parameter was dropped** (#233, #234): the OIDC callback handler extracted only `code` and `state` from the provider redirect and rebuilt the callback URL from just those two, discarding everything else. Providers implementing RFC 9207 (OAuth 2.0 Authorization Server Issuer Identification) append `iss` to the redirect and `openid-client`'s `authorizationCodeGrant()` validates it, so the token exchange failed with "issuer parameter missing" and login never completed. The Fastify callback route now forwards the full `request.query` through `handleOidcCallback` into the provider, which replays every parameter onto the callback URL handed to the token exchange (so `iss`, `session_state`, etc. survive); the required `code`/`state` are always re-asserted from the validated values. Duplicated/array-valued query params are collapsed to a single value with `searchParams.set` instead of being appended, since OIDC authorization-response params are single-valued per RFC 6749 / RFC 9207, avoiding a malformed URL with duplicate `iss`/`code` reaching `authorizationCodeGrant`. Covered by new tests across the route, service and provider layers, including the array-collapse and undefined-param branches

### Security
- **Cross-tenant project access via unvalidated `projectId` (authenticated)**: several routes accepted both an `organizationId` and a `projectId`, verified the caller was a member of the organization, but never verified that the supplied project actually belonged to that organization. Since project UUIDs are normal identifiers that appear in dashboard URLs and client API calls, a user could pair their own `organizationId` (membership check passes) with a victim's known `projectId` and reach another tenant's data. Confirmed on four handlers: `POST /api/v1/alerts/preview` returned `sampleLogs` (time, service, level, message, trace ID) from the foreign project; `POST /api/v1/alerts` and `POST /api/v1/monitors` let a rule/monitor be scoped to a foreign project (the monitor case also surfaces on the victim's public status page, which renders by `project_id`); and `GET`/`DELETE /api/v1/sourcemaps` let a member list or **delete** another tenant's source maps. Fix: a shared `projectsService.projectBelongsToOrg(projectId, organizationId)` helper (single `projects` lookup filtered on both `id` and `organization_id`) is now enforced right after the existing membership check on each of those routes, returning `403` when the project is foreign. The alert/monitor *update* paths don't accept a `projectId` and the custom-dashboards panel pipeline already had an equivalent `ensureProjectInOrg` guard at its choke point, so no change was needed there. Regression tests cover each handler
- **Server-side request forgery (SSRF) and internal port scanning via monitors and webhooks (authenticated)**: HTTP/TCP uptime monitors and webhook delivery executed user-supplied targets from the backend's network with no meaningful destination validation. Monitor creation only checked that an HTTP target started with `http(s)://` and that a TCP target contained `:`; `checker.ts` then called `fetch(target, { redirect: 'follow' })` and `createConnection({ host, port })`, so a registered user could point a monitor at `http://169.254.169.254/…`, `http://127.0.0.1`, `10.0.0.0/8`, etc. and use the sanitized up/down result and timing to probe internal services. The webhook provider had only literal-string private-IP filtering (no DNS resolution, incomplete IPv6, followed redirects), leaving DNS- and redirect-based bypasses open. Fix: a centralized outbound guard (`utils/ssrf-guard.ts`) resolves hostnames and rejects loopback, private, link-local (incl. `169.254.169.254` cloud metadata), CGNAT (`100.64.0.0/10`), multicast and reserved IPv4/IPv6 ranges (including IPv4-mapped IPv6 and ULA/`fc00::/7`, link-local `fe80::/10`). TCP checks resolve-then-pin the socket to the validated address (closing DNS-rebinding between validation and connect); HTTP checks and webhook delivery follow redirects manually and revalidate every hop instead of `redirect: 'follow'`. The guard runs both at monitor create/update time (immediate `400` feedback) and at execution time (authoritative, returns a `blocked` result). Private/internal targets are **denied by default**; self-hosted deployments that legitimately monitor internal services can opt back in with `MONITOR_ALLOW_PRIVATE_TARGETS=true`, which also governs webhook delivery. Note: HTTPS does not yet pin the connected address against a custom dispatcher, so a narrow DNS-rebinding window remains for HTTP monitors (tracked for a follow-up); the reported direct-target and redirect-to-internal vectors are closed

## [0.9.5] - 2026-05-26

### Fixed
- **Metadata filters were silently ignored on ClickHouse and MongoDB** (#226, issue #224): the metadata filter operators (`equals`, `not_equals`, `in`, `not_in`, `exists`, `not_exists`, `contains`) were only translated by the TimescaleDB query builder. The ClickHouse and MongoDB query translators never read `params.metadataFilters`, so any log search or alert rule that relied on a `metadata.*` filter came back unfiltered on those engines (the filter appeared to do nothing). ClickHouse now translates each filter to a predicate over the JSON `metadata` column using `JSONExtractString` paired with `JSONHas` to distinguish a missing key from an empty string (`not_in`/`not_equals` split on whether the key is present, `contains` uses `positionCaseInsensitive`). MongoDB builds one clause per filter keyed on `metadata.<key>`, all wrapped in `$and` so repeated filters on the same key don't overwrite each other, with `include_missing` controlling whether `not_equals`/`not_in` also match documents where the field is absent (`$exists`). Covered by new per-engine translator tests
- **Error notifications spammed one email per occurrence**: `processErrorNotification` sent an in-app notification, email and webhook for *every* exception occurrence, suppressed only when the error group's status was `ignored`. A high-frequency client error (e.g. a Svelte `effect_update_depth_exceeded` loop firing thousands of times) produced one exception row per occurrence and therefore thousands of identical alert emails. The job now throttles per error group: it atomically claims a notification slot via `UPDATE error_groups SET last_notified_at = now() WHERE status != 'ignored' AND (last_notified_at IS NULL OR last_notified_at <= cutoff) RETURNING id`, so only the first occurrence inside the cooldown window notifies and the rest are skipped. The conditional UPDATE is race-safe (concurrent jobs serialize on the row lock and re-evaluate the predicate against the freshly written timestamp), so even a burst of thousands collapses to a single notification per window. Cooldown is configurable via `ERROR_NOTIFICATION_COOLDOWN_MINUTES` (default 15, set `0` to notify on every occurrence). Occurrence counts on the error group and in-app dashboards are unaffected
- **`monitoring` rejected by the notification-channels defaults endpoint**: `PUT`/`GET /api/v1/notification-channels/defaults/:eventType` validated `:eventType` against a local Zod enum of `['alert', 'sigma', 'incident', 'error']` that was missing `monitoring`, even though the shared `NotificationEventType` type, the DB `organization_default_channels` constraint (migration 037) and the service all support it. Setting a default monitoring channel returned `400 Validation error` ("received 'monitoring'"). Added `monitoring` to the route enum so the five event types are consistent across the stack

### Added
- **Migration 043 `error_notification_throttle`**: adds a nullable `last_notified_at TIMESTAMPTZ` column to `error_groups`, used as the per-group notification cooldown anchor (see the error-notification throttle fix above)

### Security
- **Resolved 19 Dependabot advisories** (8 high, 11 moderate) by bumping direct dependencies and pinning patched versions through the root pnpm `overrides`. `protobufjs` → `7.6.1` (kept on the 7.x line via `>=7.5.8 <8`; covers code injection, prototype-pollution gadget, unbounded-recursion DoS, unsafe option paths, crafted-field DoS, overlong UTF-8 in `@protobufjs/utf8 >=1.1.1`). `kysely` → `0.28.17` (bounded `>=0.28.17 <0.29`; JSON-path traversal injection in `JSONPathBuilder.key()`/`.at()`). `svelte` → `5.55.9` (`>=5.55.7`; SSR XSS via spread attributes and promise serialization, DOM-clobbering XSS, `<svelte:element>` ReDoS). `@sveltejs/kit` → `2.61.1` (`>=2.60.1`; `query.batch` cross-talk). `fast-uri` → `3.1.2` (path traversal + host confusion via percent-encoded segments). `qs` → `6.15.2` (DoS in `qs.stringify`), `devalue` → `5.8.1` (sparse-array DoS), `brace-expansion` → `5.0.6` (numeric-range DoS), `ws` → `8.21.0` (uninitialized memory disclosure). `protobufjs` and `kysely` were deliberately held on their current major/minor lines (their "latest" is a breaking jump) while still landing on the patched release

## [0.9.4] - 2026-05-05

### Changed
- **`GET /api/v1/projects/data-availability` rewritten to read from cached flags on `projects`** instead of fanning out `N*3` existence queries to the reservoir per call. In production (ClickHouse, ~70M rows) the old path scanned `count(*)` and `LIMIT 1` probes across logs/traces/metrics for every project in the org, taking 6s+ on non-trivial orgs. The new path is a single `SELECT id, has_logs_at, has_traces_at, has_metrics_at FROM projects WHERE organization_id = $1` plus an in-memory staleness filter against `organizations.retention_days`, returning in <50ms regardless of ingest volume. The response shape is unchanged (`{ logs: string[], traces: string[], metrics: string[] }`)
- **Ingest paths mark data-availability flags fire-and-forget**: after a successful batch in logs / traces / metrics ingest, `projectsService.markHasData(projectId, kind)` updates `projects.has_X_at`. A module-scoped in-memory debounce (5 min per `(projectId, kind)`) prevents UPDATE spam on hot projects: at most one UPDATE per 5 min per pod per project per kind. Failures are logged and swallowed so ingest is never impacted; the boot-time backfill is the safety net

### Added
- **Migration 042 `project_data_availability`**: adds nullable `has_logs_at`, `has_traces_at`, `has_metrics_at` `TIMESTAMPTZ` columns to `projects`. No backfill in SQL (handled at runtime, see below)
- **One-shot backfill at server boot**: `runDataAvailabilityBackfill()` runs fire-and-forget after `app.listen`, guarded by a `data_availability.backfilled` row in `system_settings` so subsequent boots are a no-op. It selects every project with all three flags still NULL and, for each, runs three `LIMIT 1` probes (logs / traces / metrics) via the reservoir in parallel. Throttled in batches of 10 with a 50ms pause to avoid hammering ClickHouse/Timescale/Mongo at boot. On a deployment with 1000 projects this takes ~6s on ClickHouse or MongoDB, up to ~30s on TimescaleDB when most projects are empty (chunk scan confirming zero rows). Force a re-backfill by deleting the safety row
- **Multi-engine staleness rule**: a project is reported as "has data" only if `has_X_at >= now() - organizations.retention_days`. Handles the "data aged out by retention" case without needing a background worker. The same logic works identically on TimescaleDB, ClickHouse and MongoDB deployments because the flag lives in Postgres and the reservoir only backs the ingest and backfill paths

### Fixed
- **`activity_overview` dashboard panel showed empty `logs` / `log_errors` series on ClickHouse and MongoDB**: the fetcher in `panel-data-service.ts` gated both the logs and the spans queries behind `reservoir.getEngineType() === 'timescale'`, so on non-Timescale engines those branches were skipped entirely and the panel rendered with all four log/span counters flat at zero (only `detections` and `alerts`, which read from Postgres operational tables, kept working). The logs path now branches: TimescaleDB still uses the `logs_hourly_stats` / `logs_daily_stats` continuous aggregate with the raw `logs` fallback, while ClickHouse and MongoDB go through `reservoir.aggregate({ interval: '1h' | '1d' })` (same dual pattern already used by `baseline-calculator`). Bucket boundaries from `toStartOfHour` / `$dateTrunc` align with the panel's UTC `buildBucketTimes`, so the keys collide cleanly. `logs` sums `total` per bucket, `log_errors` sums `byLevel.error + byLevel.critical`. Spans / span_errors stay TimescaleDB-only because `IReservoir` has no `aggregateSpans()` primitive, matching the existing convention in `trace_latency` and `trace_volume`
- **Missing `<title>` on 14 dashboard pages**: every tab opened on `/dashboard`, `/dashboard/admin/{organizations,projects,users,settings}` (list and detail), `/dashboard/monitoring` (list and detail) and `/dashboard/projects/[id]/{alerts,overview,performance,settings}` showed the generic fallback "LogTide" from `app.html` because no `<svelte:head><title>...</title></svelte:head>` was set on the page. They now follow the existing `Title - LogTide` convention used by the rest of the app, with dynamic titles where the entity is already in scope: `{$activeDashboard.name}` for the custom dashboards root, `{org.name}` / `{project.name}` / `{user.name ?? user.email}` / `{monitor.name}` for the four `[id]` pages (each with a sensible fallback while the loader resolves). The two pure-redirect pages (`/dashboard/projects/[id]` and `/dashboard/settings`, which `goto` their default sub-route on mount) intentionally keep no title since the destination sets one immediately

### Security
- **Bump `uuid` to 14.0.0** (GHSA-w5hq-g745-h8pq, CVE-2026-41907, MODERATE): `v3`, `v5` and `v6` accepted a caller-provided `buf` + `offset` but did not validate bounds, so a small buffer or an out-of-range offset produced silent partial writes instead of throwing `RangeError` like `v1`/`v4`/`v7` do. uuid is pulled in transitively by `bullmq` and `ldapts` (production) and `bson`/`ioredis` (dev only); both production consumers resolve to their ESM entry points from our `"type": "module"` backend, so the major bump from `^11.1.0` is safe (uuid 12+ dropped CommonJS, but we never load the CJS path). Added `"uuid": ">=14.0.0"` to the root pnpm overrides; resolves to `14.0.0`. Engines requirement of Node 20+ is already satisfied by `engines.node: ">=20.0.0"`
- **Bump `fast-xml-parser` to 5.7.3** (GHSA-gh4j-gqv2-49f6, CVE-2026-41650, MODERATE): `XMLBuilder` did not escape the `-->` sequence in comment bodies or the `]]>` sequence in CDATA sections, so user-controlled data flowing into either could break out and inject sibling XML nodes (XSS in browser-rendered XML, SOAP injection, RSS/SVG payloads, etc.). The fix lands in 5.7.0; we use it transitively only via `@aws-sdk/xml-builder` pulled in by `@types/nodemailer` (dev), but bumping the override from `>=5.5.7` to `>=5.7.0` clears the lockfile advisory. Resolves to `5.7.3`

## [0.9.3] - 2026-04-18

### Added
- **Traces live tail (SSE)**: new `GET /api/v1/traces/stream` Server-Sent Events endpoint polls the traces table once a second and emits new `trace_id`s as they appear, filtered by `projectId`, `service` (CSV) and `error`. On the frontend the traces page now has a "Live tail" switch + rows-limit selector (50/100/200/500/1000, persisted in `localStorage`) in the filter bar; incoming traces are prepended and the list is capped at the chosen limit. The `tracesEventSource` is torn down on `onDestroy` and on every filter-key change
- **Traces row click-to-expand with inline span list**: clicking a trace row now toggles an inline panel below it that fetches `GET /api/v1/traces/:traceId/spans` once (cached per `trace_id` for the session) and shows a compact table with Service / Operation / Kind / Duration / Status for each span. The "View" action still opens the full trace detail page
- **Traces keyboard shortcuts**: `/` focuses the Trace ID input, `r` refreshes, `j`/`k` move the selection down/up with scroll-into-view, `enter` expands/collapses the selected trace. Registered via `shortcutsStore` under scope `traces` and unregistered on destroy
- **Traces export (JSON / CSV)**: new Export popover in the filter bar produces a client-side download of the current list (disabled during live tail or when the list is empty). CSV covers start_time / service / operation / duration_ms / span_count / error / trace_id
- **Monitoring entry in the command palette**: `cmd+k` now lists `Monitoring` under Navigation (icon + `g o` shortcut hint), matching the sidebar's Detect group so the page is reachable without leaving the keyboard
- **`trace_volume` dashboard panel**: new panel type that plots span count over time (optional errors line), configurable time range (`1h`/`6h`/`24h`/`7d`) and optional service filter. Mirrors the shape of the existing logs "Log Volume" panel but for OTLP traces. Reads the `spans_hourly_stats` / `spans_daily_stats` continuous aggregate first, falling back to the raw `spans` hypertable with `date_trunc` only when the cagg is empty for the window (covers the `end_offset=1h` refresh lag on freshly-ingested data). TimescaleDB-only
- **`activity_overview` dashboard panel**: unified multi-series timeline combining logs, log errors, spans, span errors, detection events and alert triggers on a common bucket grid (hourly for ≤24h, daily for 7d/30d). Each series is individually toggleable in the config form. Per-source queries run in parallel and prefer the `logs_*_stats`, `spans_*_stats`, `detection_events_*_stats` continuous aggregates for cost; if a cagg returns zero rows for the window the fetcher falls back to the raw hypertable (`logs`, `spans`, `detection_events`) for that source only, so the panel stays correct on freshly-ingested data without running a raw scan in the hot path. Alerts always come from `alert_history` + `alert_rules` (no cagg exists for it)

### Changed
- **Monitoring page reorganized into tabs**: what was a single 1000-line scroll with three unrelated sections (Monitors, Incidents, Maintenance) plus a status-page config block wedged at the top is now a `Tabs.Root` with four tabs — **Monitors**, **Incidents**, **Maintenance**, **Status page** — each with its own header, its own primary CTA, and its own empty state. The Monitors tab gains a summary card grid (Total / Up / Down / Paused, each card clickable to filter the list by that status), a search input that matches name / target / type, and a "Clear filters" shortcut. Every row now has a one-click Pause/Resume button (previously buried in the edit form). Status-page visibility, password, slug and embed-badge config moved into the Status page tab. No changes to underlying API calls or permissions
- **Admin dashboard sidebar collapses on mobile**: the 256px admin sidebar was previously always visible, taking up a huge chunk of the viewport on phones. It now hides below `lg:` and opens as a fixed drawer triggered by a hamburger in a new mobile-only sticky header that also shows the current section name (Dashboard / Users / Organizations / etc). The drawer has a backdrop, is dismissed on nav-click or backdrop-click, and locks body scroll while open. Desktop behaviour unchanged
- **Dashboard footer wraps properly on mobile**: was a single `justify-between` row that squeezed "LogTide / Alpha v0.9.2" against "© 2026 LogTide · Documentation · GitHub" on narrow screens. Now stacks the brand block over the links block below `sm:` (each block keeps its own horizontal flow with `flex-wrap gap-x-4 gap-y-1`), and "Documentation" shortens to "Docs" under `sm:` to fit on a single line. Container padding also drops from `px-6 py-4` to `px-4 py-3` on mobile
- **User settings promoted from a dialog to a full page** at `/dashboard/account`. The cramped scrollable `UserSettingsDialog` modal (profile + password + tutorial restart + danger zone stacked inside a 32rem-wide overlay) is now a proper route using a `max-w-3xl` container with each concern split into its own `rounded-lg border bg-card` section (Profile / Change password / Onboarding / Danger zone). The dropdown menu item still says "User Settings" but now navigates instead of opening an overlay. `UserSettingsDialog.svelte` is removed. The delete-account confirmation remains a nested `AlertDialog` since that one is genuinely destructive and modal-appropriate
- **Public status page polished for mobile and clarity**: outer container shrinks from `px-4 py-10` to `px-3 py-6` on phones (only `sm:` and up gets the roomy desktop padding). The 45-day uptime bars drop their `min-w-[6px]` floor to `4px` on mobile so the whole row fits comfortably on 320px viewports. The footer ("Last updated …" and "Powered by LogTide") grows from `text-[10px]` to `text-xs` with a taller top margin, and "LogTide" is now styled as `text-primary font-medium hover:underline` so the link affordance is obvious (previously only a hover recolor). Incident update timestamps/status labels also bumped from `text-[10px]` to `text-xs`. The monitor-type badge (HTTP/TCP/etc.) hides below `sm` to free up the row for the name + uptime%. The password input switches from a fixed `w-64` to `w-full max-w-xs` so it never overflows narrow phones
- **Monitoring forms moved into modal dialogs**: the previous inline create/edit monitor form, the "New incident" form, the "Post incident update" form and the "Schedule maintenance" form were expanding/collapsing sections that shifted the whole page layout when opened. They now open as centered `Dialog` modals with `max-h-[90vh] overflow-y-auto` so tall forms (monitor create) scroll independently of the page. The per-row "Post update" Dialog is a single instance driven by a `showUpdateForm` id + an `updatingIncident` derived lookup, replacing the one-per-row inline expand. Form state, validations and submit handlers are untouched
- **Traces filter UI reworked into the same two-row pill bar as the search page**: row 1 keeps Time Range (`TimeRangePicker` in a popover), the Live tail switch, the List/Map view toggle and the Export menu. Row 2 exposes every filter as its own always-visible pill — Project (single-select), Services (multi-select), Status (tri-state: all / errors / ok), Duration range (min/max ms inputs), Trace ID (direct-navigate to the trace detail page). Pills switch to the `secondary` variant when a non-default value is set; "Clear all" appears when any filter is active. Mobile popovers use `w-[Xpx] max-w-[90vw]` so they never overflow the viewport. `handleTimeRangeChange` syncs picker state back into `timeRangeType` / `customFromTime` / `customToTime` so the trigger label survives popover close/remount
- **Traces backend accepts multi-value `projectId` and `service`** (CSV on the query string) and two new `minDurationMs` / `maxDurationMs` bounds on `GET /api/v1/traces`. The cross-project access check loops over every project in the list. `tracesService.listTraces` widens its input types to `string | string[]` and forwards to `reservoir.queryTraces`, which already supported these filters
- **Search page paginator now uses the same ellipsis/windowed control as the traces page**: shows up to four numbered buttons plus sentinel `…` on each side when `totalPages > 7`. Falls back to the previous "Page N" label when the backend doesn't return a total (storage engines without `total` in the query response). "Previous" / "Next" labels hide on `<sm` screens so only the chevron shows on phones
- **Empty states wait for the first load to complete before rendering** on the search, traces, errors and security-incidents pages. Each page now tracks a `hasLoadedOnce` flag flipped in the `finally` branch of its loader; until the first fetch resolves (success or failure) the page shows its skeleton instead of the "No Logs Yet / Start sending logs from your applications" onboarding card. Prevents the flash where an org that already has data showed the onboarding CTA during the initial render between mount and the first query. When a fetch legitimately returns zero rows, the page also distinguishes "nothing matches these filters" (with a Clear-filters shortcut) from "project has no data at all" (the full onboarding)
- **Search page filter UI reworked into a two-row pill bar**: row 1 keeps Search + mode, a Time Range popover trigger, Live Tail and Export inline. Row 2 exposes every filter as its own always-visible pill (Projects, Services, Hostnames, Levels, Trace ID, Session ID, Metadata) — each pill displays the current value (e.g. "Service: api-gateway", "Levels: 2") and opens its own popover for editing. Pills switch to the `secondary` variant when a non-default value is set so active filters are visible at a glance. A "Clear all" link appears at the end of the row when any filter is active. Popover widths use `w-[min(Xpx,calc(100vw-1rem))]` so they never overflow the viewport on phones. No semantic change to the underlying filter behavior (state, query params, live-tail flow, metadata apply/clear) - purely a layout/affordance pass replacing the previous six-column "Filters" Card
- **Auto-created Default dashboard now uses the new `activity_overview` panel** instead of the logs-only `time_series` "Log Volume" chart. Existing organizations keep their current dashboard untouched; the swap only affects orgs that don't yet have a default (i.e. new signups or orgs where the default was deleted and re-seeded via `ensureDefaultExists`)
- **Opt-in async buffer for reservoir writes**: new `ReservoirBuffered` decorator sits between the ingestion API and the storage engine. When enabled via `RESERVOIR_BUFFER_ENABLED=true`, POST `/api/v1/ingest` returns as soon as records are accepted into a shard-partitioned queue; a flush consumer pool drains to storage asynchronously. Two transports ship in the box: an optimized in-memory queue with signal-based wakeup (single-instance, not crash-safe) and a Redis Streams transport with consumer groups, `XAUTOCLAIM`-based stale reclaim, atomic `MULTI/EXEC` nack, and a DLQ side stream (multi-instance, durable). Circuit breaker bypasses to sync ingestion when the buffer fills beyond a configurable pending threshold or after repeated flush failures in a rolling window. Off by default; see `docs/async-buffer/` for when to enable and the per-engine benchmark table
- **`IReservoir` shared interface**: public type that `Reservoir` and `ReservoirBuffered` both implement, so downstream code (backend monitoring, etc.) can type against `IReservoir` without caring which implementation is live
- **Prometheus-style buffer metrics**: `reservoir_buffer_enqueued_total`, `reservoir_buffer_bypass_total`, `reservoir_buffer_flush_success_total`, `reservoir_buffer_flush_failure_total`, `reservoir_buffer_flush_duration_ms` (histogram), `reservoir_buffer_dlq_total`, `reservoir_buffer_breaker_state` (0 closed / 1 open / 2 half-open). All labelled by record kind and shard where applicable
- **Warning at startup when buffer is enabled on non-Timescale engines**: benchmarks show the buffer regresses p95 under saturation on ClickHouse and MongoDB (the bottleneck is the flush side, which the buffer cannot hide). The backend now logs a clear warning with a link to the docs when `RESERVOIR_BUFFER_ENABLED=true` is set together with `STORAGE_ENGINE=clickhouse` or `STORAGE_ENGINE=mongodb`
- **k6 load-test script `load-tests/buffered-vs-sync.js`** (`pnpm --filter @logtide/backend load:buffered-vs-sync`): constant-arrival-rate 100 req/s for 3 min, batch size 10, reports p50/p95/p99 + error rate. The file lives in the gitignored `load-tests/` directory; only the npm script is checked in
- **Graceful shutdown now drains the reservoir buffer in parallel with Fastify `app.close()`**: previously serialized, so a slow `app.close()` (BullMQ workers, websocket connections) could exhaust the container stop timeout before `shutdownReservoir()` ran. The new order calls them via `Promise.all`, giving the buffer its full `RESERVOIR_BUFFER_GRACEFUL_SHUTDOWN_MS` window to drain regardless of how long `app.close()` takes
- **Redis client in the backend's buffer path is now explicitly `quit()`-ed on shutdown**: `RedisStreamTransport` documents that it does not own the client, so the backend owns the lifecycle. Without this, the Redis connection was torn down by the process exit instead of closing cleanly
- **Buffer start-up failure is fail-fast**: when `RESERVOIR_BUFFER_ENABLED=true` and the consumer pool cannot start (e.g. Redis down at boot), the backend logs a CRITICAL message and `process.exit(1)` instead of silently continuing with a non-flushing buffer
- **`RedisStreamTransport` hardening**: `XPENDING` now filters by consumer name in `claimStale`, so delivery-count mapping is accurate even on busy streams with claims from other consumers; `getStats.oldestPendingAgeMs` now tracks the oldest not-yet-delivered entry (via `XRANGE` with exclusive start past the PEL tail) to match the documented contract; `nack` uses `MULTI`/`EXEC` so the DLQ write and the original ACK either both land or neither does; `enqueueMany` inspects pipeline `exec()` results and throws on the first error instead of swallowing them; default consumer name changed from `consumer-${pid}` to `${hostname}-${pid}-${randomHex}` to avoid collisions between containers with the same PID
- **`FlushConsumer` isolates partial failures by kind**: the three ingest calls (`ingest`, `ingestSpans`, `ingestMetrics`) now run via `Promise.allSettled`; the breaker records success only when all three succeed; metrics reflect per-kind reality; DLQ only counts the failed kinds on retry exhaustion. An optional `FlushLogger` can be injected; default falls back to `console`
- **`FlushConsumerPool` relaxes drain check to `pendingRecords == 0`**: previously also required `inflightRecords == 0`, which never converged when another backend instance held claims on the same Redis consumer group. Consumer-task crashes are now surfaced via `logger.error` instead of being swallowed by `Promise.allSettled`. Drain poll bumped from 50 ms to 200 ms to reduce chatter
- **`InMemoryTransport` uses signal-based wakeup**: `dequeue` no longer polls every 50 ms; enqueues wake waiters directly via a per-shard resolver list, and `stop()` unblocks waiters promptly. `enqueueMany` now batches records into a single `Array.push(...entries)` per shard plus one wake, eliminating the N-await bottleneck that made the in-memory buffer slower than sync on fast TimescaleDB workloads (p95 dropped from 4224 ms to 24 ms in the 3-min 100 req/s test)
- **Reservoir exposes `getEngine()` on the concrete `Reservoir` class (not on `IReservoir`)**: replaces the `(inner as unknown as { engine }).engine` cast inside `ReservoirBuffered`'s constructor. Kept out of the public interface so backend consumers typed against `IReservoir` cannot reach the engine and bypass the decorator
- **`ReservoirBuffered.ingest/ingestSpans/ingestMetrics` return the correct `IngestResult` shape**: `{ ingested, failed, durationMs }` instead of the previous `{ inserted }` masked by `as unknown as` casts. `durationMs` measures the enqueue time, so the value reflects the real cost imposed on the caller

## [0.9.2] - 2026-04-16

### Added
- **Generic metadata filters in log search and alert rules**: the search page and alert rule dialogs now expose a "Metadata filters" section backed by a new `MetadataFilterBuilder` component. Supported operators: `equals`, `not_equals`, `in`, `not_in`, `exists`, `not_exists`, `contains`. Filters are applied server-side via a GIN-indexed JSONB query builder in reservoir; alert evaluation also runs the same matcher in-process so rules can fire only when a specific metadata field matches
- **Configurable metadata columns in log table view**: users can add arbitrary `metadata.*` keys as extra columns in the search results table via a "Columns" picker. The selected column set is persisted per project in localStorage so it survives page reloads
- **Create user from admin panel** (issue #198): admins can now provision new accounts directly from `Admin → User Management` via a "Create User" button, without having to temporarily re-enable public signup. Opens a dialog to set email, name, password and optional admin role. Backed by a new `POST /api/v1/admin/users` endpoint that bypasses the `auth.signup_enabled` gate and logs a `create_user` entry to the audit log
- **Set a custom dashboard as default from the UI**: the dashboard switcher now shows a clickable star next to each org-wide, non-personal dashboard; clicking it promotes that dashboard to be the org's default. Backed by a new `POST /api/v1/custom-dashboards/:id/set-default` endpoint that atomically unsets the previous default and sets the new one in a single transaction, respecting the existing partial unique index. Personal and project-scoped dashboards are rejected with a 400
- **Editable project slug from monitoring page**: the status-page settings card in `/dashboard/monitoring` now exposes a "Public URL slug" input that lets the user rename a project's slug, with inline validation against a shared format check (lowercase alphanumeric + hyphens, 2-50 chars), reserved-word list (`api`, `admin`, `dashboard`, `status`, `auth`, `login`, `signup`, `logout`, `_app`, `health`), and per-org uniqueness. Conflicts surface as 409 with a friendly inline error; race conditions are caught at the DB layer via the new composite unique index
- **Editable organization slug from settings**: `/dashboard/settings/general` slug field is no longer read-only; owners can rename the org slug with the same validation rules and global uniqueness, with a warning that any existing status-page links and embed badges will break

### Changed
- **Public status page URL is now scoped under the organization** (BREAKING): page and badge URLs changed from `/status/:projectSlug` to `/status/:orgSlug/:projectSlug`. Affects the public web page, `/api/v1/status/:orgSlug/:projectSlug/badge.svg`, and `/api/v1/status/:orgSlug/:projectSlug/badge.json`. No redirect from the old URLs. Anyone embedding the badge SVG/JSON or sharing a status-page link must update the URL to include the org slug. Migration `040` simultaneously moves project-slug uniqueness from global back to per-org, so two different organizations can now both have a project named `frontend` without auto-suffixing

### Fixed
- **Security dashboard crashed with "Cannot read properties of null (reading 'toLowerCase')"** (issue #200): root cause was two parallel `unnest(mitre_techniques)` / `unnest(mitre_tactics)` calls in the same SELECT list of `SiemDashboardService.getMitreHeatmap`. PostgreSQL evaluates sibling set-returning functions in lockstep and NULL-pads the shorter array, so any detection event whose tactic and technique arrays had different lengths produced heatmap rows with a null tactic, which then crashed `MitreHeatmap.abbreviateTactic` on the frontend. The heatmap query now unnests techniques only and resolves each one to its canonical tactic via the shared `MITRE_TECHNIQUES` map (with sub-technique to parent fallback), eliminating the malformed pairs at the source. Frontend `MitreHeatmap` also filters cells with null tactic/technique and `DetectionEventsList.getLogLevelClass` defensively handles a null `level` as belt-and-suspenders

### Security
- **Bump `fastify` to 5.8.5** (GHSA-247c-9743-5963, CVE-2026-33806, HIGH): body schema validation could be bypassed by prepending a single space to the `Content-Type` header. Parser and validator disagreed on how to trim the header, so the body was still parsed but the schema lookup returned no validator and validation was skipped entirely. Upgraded from `^5.8.3` to `^5.8.5`
- **Bump `@sveltejs/kit` to 2.57.1** (GHSA-2crg-3p73-43xp, CVE-2026-40073, HIGH): `BODY_SIZE_LIMIT` could be bypassed under certain conditions in `adapter-node`. Tightened the pnpm override from `>=2.53.3` to `>=2.57.1`
- **Bump `@sveltejs/kit` to 2.57.1** (GHSA-3f6h-2hrp-w5wx, CVE-2026-40074, MEDIUM): calling `redirect` inside the `handle` hook with a location containing characters invalid for an HTTP header threw an unhandled `TypeError`, enabling DoS if the location included unsanitized user input

## [0.9.1] - 2026-04-14

### Fixed
- **Identifier pattern update/delete failed with "Organization ID is required"** (issue #193): PUT and DELETE routes required `organizationId` as an explicit query param or API key context, but session-based auth never sets that field. Now falls back to the user's first organization, consistent with GET and POST
- **Project rename failed with "Expected string, received null"** (issue #195): `updateProjectSchema` used `z.string().optional()` which rejects `null`, but projects without a description send `null` from the DB. Changed to `z.string().nullable().optional()` and updated `UpdateProjectInput` accordingly
- **Pipeline create/preview/import returned generic "Validation error"** (issues #193, #194): POST routes expected `organizationId` in the request body but the frontend sends it as a query param. Routes now merge the query param into the body before Zod validation. Frontend error messages now surface the first validation detail instead of the generic label
- **Invitation accept race condition**: wrapping the membership check + insert in a transaction caused the `accepted_at` update to roll back when throwing "already a member". Split the early-exit path out of the transaction and added `23505` unique-constraint handling for true concurrent accepts
- **SSE live tail duplicate sends**: `latestLog` picked the oldest entry from a DESC-sorted array instead of the newest, causing every poll to re-fetch and re-send all logs since the oldest timestamp. Replaced with a defensive max-time computation
- **Sigma sync corrupted `alert_rule_id` FK**: fallback `alertRuleId || existing.id` wrote the sigma rule's own PK into the alert_rules FK column when no alert was auto-created. Now omits the column entirely unless a new alert rule was just created
- **Exception log viewer returned empty results for org-wide error groups**: `getLogsForErrorGroup` passed an empty string as `projectId` to reservoir when no project filter was set. Now groups log IDs by their exception's `project_id` and issues one `getByIds` call per project
- **ReDoS in HTTP monitor body assertion**: user-supplied regex pattern was compiled with only a 256-char length limit, no catastrophic-backtracking check. Added `safe-regex2` validation and a compile-error catch
- **OTLP int64 precision loss**: `parseInt()` silently truncated int64 attribute values exceeding `Number.MAX_SAFE_INTEGER`. Unsafe values are now kept as strings in metadata
- **PII salt race condition fallthrough**: if two workers raced on the first hash for an org, the loser could return an unpersisted local salt when the retry read failed, permanently desynchronizing PII hashes. Now scopes the catch to `23505` and throws on unexpected errors
- **Monitor status fallthrough on missing row**: `processCheckResult` silently skipped the entire state machine (no status update, no notifications) when `monitor_status` was undefined. Now re-reads from DB or creates a default row before proceeding
- **Test isolation: auth mode pollution across test files**: `system_settings` was never reset between tests, so any test setting `auth.mode='none'` caused 12 unrelated "401 without auth" assertions to return 503. Added cleanup + cache invalidation to global `beforeEach`
- **Sigma detection tests used `sigma_id` after code migrated to `id`**: fixture data still passed `rule.sigma_id` as `sigmaRuleId`, which would not match the new `.where('id', '=', ...)` queries
- **`translateDelete` dropped level filter in reservoir**: `pushFilter` return value was discarded for the `level` condition, corrupting `$N` parameter slots when both `service` and `level` filters were present
- **SQL injection in `querySpans` via `sortBy`/`sortOrder`**: user-controlled strings were interpolated directly into raw SQL in both TimescaleDB and ClickHouse engines. Added explicit column/direction allowlists
- **`ingestSpans` hardcoded `::uuid[]` for `project_id`**: ignored the `projectIdType` engine option, breaking text-based project IDs with a Postgres cast error
- **`localStorage` SSR crash in organization store**: 7 direct `localStorage` calls without a `browser` guard would throw `ReferenceError` during server-side rendering. Added `browser` check on all accesses
- **Invite token not URL-encoded in redirect**: `goto(/login?redirect=/invite/${token})` corrupted the redirect path for tokens containing `+`, `=`, or `/`. Now wraps in `encodeURIComponent`
- **`ruleId` not URL-encoded in security dashboard navigation**: inconsistent with `serviceName` and `technique` which already used `encodeURIComponent`
- **Missing UUID validation on monitoring route params**: all `/:id` handlers passed `request.params.id` directly to DB queries without format validation. Added Zod `.uuid()` parsing on every route
- **Negative `limit`/`days` in monitoring routes**: `Number("-1") || 50` evaluates to `-1` (truthy), passing a negative value to `LIMIT`. Replaced with a `parsePositiveInt` guard that clamps to `[1, max]`
- **Missing UUID validation on status-incident route params**: same issue as monitoring - `:id` params were used unvalidated in DB queries
- **SIEM comment body has no max length**: `z.string().min(1)` with no upper bound allowed arbitrarily large comment payloads. Added `.max(10000)`
- **Notifications and alerts `limit`/`offset` NaN passthrough**: `parseInt("abc")` returned `NaN`, which was passed to Kysely `.limit(NaN)`. Added safe integer parsing with fallback and max cap
- **Correlation `referenceTime` accepted invalid date strings**: schema validated only `{type: 'string'}`, so `new Date("garbage")` flowed into Kysely WHERE clauses as Invalid Date. Added `format: 'date-time'` and a defensive 400 response
- **Log pipeline comment contradicted jsonb merge direction**: code comment said "do NOT overwrite existing" but the in-progress fix had flipped the jsonb `||` operand order so pipeline fields now win. Updated comment to match actual behavior

## [0.9.0] - 2026-04-11

### Added
- **Service health monitoring and status pages** (issue #152): proactive uptime monitoring with auto-generated public status pages
  - **3 monitor types**: HTTP/HTTPS (configurable method, expected status, headers, body assertion), TCP ping, and heartbeat (alert when no ping received within grace window)
  - **HTTP config**: per-monitor `httpConfig` with method, expectedStatus, custom headers, and body assertion (contains or regex) - stored as JSONB, validated via Zod
  - **Per-monitor severity**: incident severity is configurable per monitor (`critical`, `high`, `medium`, `low`, `informational`) instead of hardcoded `high`
  - **BullMQ-style polling**: worker checks all due monitors every 30s, batched in groups of 20 concurrent checks via `Promise.allSettled`
  - **TimescaleDB storage**: `monitor_results` hypertable with 7-day compression, 30-day retention, and `monitor_uptime_daily` continuous aggregate refreshed hourly
  - **State machine**: consecutive failure tracking with configurable threshold, atomic incident dedup guard (`WHERE incident_id IS NULL`), auto-resolve on recovery
  - **Auto-incident creation**: when failure threshold is crossed, a SIEM incident is created with `source: 'monitor'` and linked via `monitor_id`; notifications sent via existing email/webhook channels
  - **Public status page** (`/status/:projectSlug`): Uptime Kuma-inspired design with 45-day heartbeat bar grid, per-monitor uptime badge, overall status banner, custom CSS tooltips, light/dark mode toggle
  - **Status page access control**: configurable visibility per project - disabled (default), public, password-protected, or org-members-only
  - **Scheduled maintenances**: create maintenance windows with start/end times; active maintenances suppress monitor incident creation and display a banner on the status page
  - **Manual status incidents**: create public incident communications (investigating → identified → monitoring → resolved) with update timeline, independent from SIEM incidents
  - **Heartbeat endpoint**: `POST /api/v1/monitors/:id/heartbeat` accepts both API key and session auth, rate-limited to 600/min
  - **Project slugs**: auto-generated from project name on creation, unique per org, backfilled for existing projects via migration
  - **Dashboard UI** (`/dashboard/monitoring`): monitor list with project selector, create/edit/delete forms with client-side validation, detail page with refresh button, uptime chart, recent checks, copy heartbeat URL
  - **Monitoring navigation**: added to sidebar under "Detect" section alongside Alerts and Security

### Fixed
- **Status page slug collision**: `getPublicStatus` now filters by `status_page_public` flag instead of returning the first project matching the slug, preventing cross-org data leaks
- **`createMonitor` not transactional**: monitor and `monitor_status` inserts are now wrapped in `db.transaction()` to prevent orphaned monitors
- **`mapMonitor` typed**: replaced `any` parameter with proper `MonitorWithStatusRow` interface for compile-time safety
- **Org membership check optimized**: monitoring routes now use a single `SELECT WHERE user_id AND organization_id` query instead of fetching all user orgs and scanning in JS
- **Redundant DB read eliminated**: `processCheckResult` now receives status data from the already-fetched monitor object instead of issuing a second SELECT
- **Target validation on update**: PUT endpoint now validates target format against monitor type (HTTP must start with `http://`/`https://`, TCP must contain `:`)
- **`$derived.by` fix**: monitor detail page uptime calculation now uses `$derived.by()` instead of `$derived(() => ...)` for correct Svelte 5 reactivity
- **`@const` placement**: replaced invalid `{@const}` inside `<div>` elements with `{#if}/{:else}` blocks for Svelte 5 compatibility
- **`uptimePct` type coercion**: Postgres `ROUND()` returns numeric as string - status page now coerces to number before calling `.toFixed()`
- **Default `failureThreshold` aligned**: frontend form default changed from 3 to 2 to match backend default
- **Test setup cleanup**: added `monitor_results`, `monitor_status`, `monitors`, `incident_alerts` to global `beforeEach` cleanup

- **Log parsing and enrichment pipelines**: define multi-step processing rules that automatically parse and enrich incoming log messages before they are stored
  - **5 built-in parsers**: nginx (combined log format), apache (identical to nginx), syslog (RFC 3164 and RFC 5424), logfmt, and JSON message body
  - **Custom grok patterns**: `%{PATTERN:field}` and `%{PATTERN:field:type}` syntax with 22 built-in patterns (IPV4, WORD, NOTSPACE, NUMBER, POSINT, DATA, GREEDYDATA, QUOTEDSTRING, METHOD, URIPATH, HTTPDATE, etc.) and optional type coercion (`:int`, `:float`)
  - **GeoIP enrichment**: extract country, city, coordinates, timezone, and ISP data from any IP field using the embedded MaxMind GeoLite2 database
  - **Async processing via BullMQ**: pipelines run as background jobs after ingestion - zero impact on ingestion latency
  - **Project-scoped vs org-wide**: pipelines can target a specific project or apply to all projects in the organization; project-specific pipelines take priority over org-wide ones
  - **Pipeline preview**: test any combination of steps against a sample log message and inspect per-step extracted fields and the final merged result before saving
  - **YAML import/export**: import pipeline definitions from YAML with `name`, `description`, `enabled`, and `steps` fields; upserts (replace existing pipeline for the same scope)
  - **In-memory cache**: `getForProject` caches the resolved pipeline per project for 5 minutes, automatically invalidated on create/update/delete
  - **Settings UI** (`/dashboard/settings/pipelines`): list, enable/disable toggle, create, edit, and delete pipelines with live org-switch reactivity (`$effect` instead of `onMount`)
  - **Step builder**: interactive UI for adding, reordering, and configuring parser, grok, and geoip steps with per-type configuration forms
  - **Pipeline edit page** redirects to the list when the active organization is switched, preventing stale-ID errors

- **Custom dashboards with configurable panels** (issue #151): user-built dashboards replace the previous fixed `/dashboard` page, with team-specific views across all observability domains
  - **9 panel types** covering every data source: time series, single stat, top-N table, live log stream, alert status (logs/alerts), metric chart and metric stat (OTLP metrics with avg/sum/min/max/count/last/p50/p95/p99 aggregations), trace latency (p50/p95/p99 from spans), detection events (SIEM by severity), monitor status (uptime + response time)
  - **Panel registry architecture**: adding a new panel type touches only 6 files (shared types, backend Zod schema, backend fetcher, frontend panel component, frontend config form, frontend registry entry); the renderer, container, store, and routes never need to change
  - **Drag-and-drop reorder** via `svelte-dnd-action` with optimistic local state and a single PUT save
  - **Drag-to-resize** with bottom-right pointer-event handle, snapping to grid units; constrained by per-type min width/height from the registry
  - **Responsive 12/6/1 column grid** that collapses panels to 6 columns on tablet (640-1024px) and 1 column on mobile (<640px); stored widths are always in the canonical 12-col reference and scale proportionally
  - **Auto-created Default dashboard** per organization, idempotent via Postgres unique-violation guard, replicating the previous fixed layout (4 stat cards + log volume + top services + top error messages) so existing users see no visual change
  - **Inline edit mode** with toggle, no separate edit page; pending changes are kept in a snapshot and discarded on Cancel
  - **Per-panel configuration dialogs** with type-specific forms (level toggles, intervals, aggregation pickers, percentile selectors)
  - **Dashboard switcher dropdown** in the page header with personal/shared distinction, create, delete (default protected), import, export
  - **YAML import/export**: dashboards round-trip through YAML for version-controlling alongside infrastructure code; import regenerates panel IDs and uses `JSON_SCHEMA` to block JS-tag prototype pollution
  - **Versioned JSON schema** (`schema_version: 1`) with a migration framework in `@logtide/shared`: each version writes a `MigrationFn` indexed by target version, `migrateDashboard` walks the chain on every read; clamps out-of-range versions defensively
  - **Cross-org isolation guard**: every panel data fetch verifies that `config.projectId` belongs to the requesting org, preventing data leaks via crafted YAML imports or stale references
  - **Batch panel data endpoint** (`POST /:id/panels/data`): single round-trip fetches all panel data via `Promise.allSettled`, individual panel errors do not fail the dashboard
  - **Organization scoping**: dashboards are org-scoped with optional `is_personal` flag (only visible to creator) and `created_by` tracking; partial unique indexes prevent multiple defaults per (org, project) scope
  - **Migration `039_custom_dashboards.sql`**: JSONB `panels` column with GIN index for future panel-type filtering, partial unique indexes for default scope guarantees

## [0.8.7] - 2026-04-06

### Fixed
- **Quick Start cURL example failed validation**: the empty-state code snippet sent `{logs: [{level, service, message}]}` without a `time` field, but `logSchema` required it for the standard ingestion path (only the array-format path ran `normalizeLogData`). The schema now defaults `time` to the current ISO string when missing, so copy-paste examples and minimal payloads validate without requiring users to inject a timestamp.
- **Noisy Sigma worker logs**: `[SigmaDetection] No matches found` was emitted at info level on every batch with no detections, flooding worker output in normal operation. The line is now gated behind `DEBUG_SIGMA=true` so it only appears when explicitly opted in.
- **No admin user when `INITIAL_ADMIN_*` not set** ([#188](https://github.com/logtide-dev/logtide/issues/188)): on a fresh instance without `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD`, no usable admin existed and admin settings were unreachable. The bootstrap no longer creates a system fallback user; instead, the first user to register (via `/register` or external auth provider) is automatically promoted to admin if no admin exists yet.

## [0.8.6] - 2026-03-31

### Fixed
- **ClickHouse traces/metrics data-availability always empty**: `queryTraces` and `queryMetrics` passed raw `0` for epoch dates as `DateTime64(3)` parameter, which ClickHouse can't parse; now uses the same `toDateTime64()` clamp used by log queries
- **Stale session after volume reset**: dashboard only checked `localStorage` for a token without validating it against the backend; now calls `/auth/me` on load and auto-logs out if the session is invalid

## [0.8.5] - 2026-03-28

### Security
- **Cross-org isolation fix in SIEM**: `linkDetectionEventsToIncident` now scopes detection events to the requesting organization, preventing cross-tenant data corruption via crafted API calls
- **Cross-org auth bypass in pattern routes**: PUT and DELETE handlers for correlation patterns now verify organization membership before mutating data (same check GET/POST already had)
- **SSRF protection for legacy webhook path**: the alert-notification job's direct `fetch()` call now validates URLs against private/internal IP ranges, matching the `WebhookProvider` safeguard
- **Disabled user login blocked**: `POST /login` now checks the `disabled` flag before creating a session, preventing disabled accounts from obtaining tokens
- **Expired invitation info leak**: `getInvitationByToken` now filters on `expires_at > NOW()`, preventing enumeration of expired invitation details

### Fixed
- **SIEM dashboard timeline crash**: `time_bucket()` call was missing `::interval` cast on the parameterized bucket width, causing a PostgreSQL type error that broke the timeline widget for all users
- **SSE real-time events broken**: SIEM store and incident detail page read auth token from `localStorage('session_token')` (wrong key), so the SSE connection never authenticated; now uses `getAuthToken()` from the shared auth utility
- **SSE log stream duplicate emission**: when multiple logs shared the same timestamp, the inclusive `from` bound caused them to be re-sent on every poll tick; stream now tracks sent log IDs to deduplicate
- **Incident severity auto-grouping wrong**: `MAX(severity)` used PostgreSQL alphabetical ordering (`medium` > `critical`), producing incorrect severity on auto-grouped incidents; now uses ordinal ranking
- **Sigma notification failures silent**: notification job payload was missing `organization_id` and `project_id`, and `markAsNotified` was called with `null` historyId; both now handled correctly
- **Incidents pagination total always zero**: `loadIncidents` in the SIEM store never wrote `response.total` to `incidentsTotal`
- **Memory leaks on navigation**: 20+ Svelte components called `authStore.subscribe()` without cleanup; all now store the unsubscribe function and call it in `onDestroy`
- **`offset=0` silently dropped**: API client functions used `if (filters.offset)` which is falsy for zero, so page-1 requests never sent the `offset` parameter; changed to `if (filters.offset != null)`
- **Search debounce timer leak**: `searchDebounceTimer` was not cleared in `onDestroy`, causing post-unmount API calls when navigating away mid-search
- **`verifyProjectAccess` double call**: when `projectId` is an array, the first element was verified twice (once before the loop, once inside it); consolidated into a single loop
- **`updateIncident` silent field skip**: `title`, `severity`, and `status` used truthy checks (`&&`) instead of `!== undefined`, inconsistent with `description` and `assigneeId`
- **Webhook error messages empty**: `response.statusText` is empty for HTTP/2; error now reads the response body for useful detail
- **Retention job crash on empty orgs**: `Math.max(...[])` returns `-Infinity`, cascading to an `Invalid Date` in the `drop_chunks` call; early return added when no organizations exist
- **`escapeHtml` DOM leak**: PDF export's `escapeHtml` created orphaned DOM nodes in the parent document; replaced with pure string replacement
- **Webhook headers validation missing**: `CreateChannelDialog` silently swallowed invalid JSON in the custom headers field; now validates on submit
- **`getIncidentDetections` no org scope**: query now accepts optional `organizationId` for defense-in-depth filtering
- **Stale shared package types**: dist contained outdated `Project` and `Incident` interfaces with phantom fields (`slug`, `statusPageVisibility`, `source`, `monitorId`); rebuilt from source

### Changed
- **Docker config sync**: `docker-compose.build.yml` now matches `docker-compose.yml` with all environment variables (MongoDB, `TRUST_PROXY`, `FRONTEND_URL`, `INTERNAL_DSN`, `DOCKER_CONTAINER`), MongoDB service, and `fluent-bit-metrics` service
- **`NODE_ENV` for backend**: production `docker-compose.yml` now sets `NODE_ENV: production` on the backend service (worker and frontend already had it)
- **`docker/.env.example`**: added `STORAGE_ENGINE`, ClickHouse, and MongoDB configuration sections

### Dependencies
- `picomatch` 4.0.3 → 4.0.4 (fix ReDoS via extglob quantifiers + POSIX character class method injection)
- `brace-expansion` 5.0.2 → 5.0.5 (fix zero-step sequence DoS)
- `fast-xml-parser` 5.5.6 → 5.5.9 (fix entity expansion limits bypass)
- `fastify` bumped via dependabot
- `kysely` bumped via dependabot

## [0.8.4] - 2026-03-19

### Added
- **Skeleton loaders and loading overlays**: all dashboard pages now show content-shaped loading states instead of blank spinners
  - New `Skeleton`, `SkeletonTable`, and `TableLoadingOverlay` components (`src/lib/components/ui/skeleton/`)
  - Directional shimmer animation via `@keyframes shimmer` using design tokens - works in light and dark mode, disabled for `prefers-reduced-motion`
  - **Initial load** (no data yet): animated skeleton rows mirroring the page layout - stat cards on `/dashboard`, project cards on `/dashboard/projects`, table rows on search, traces, errors, admin tables, incidents, alerts history, and members
  - **Re-fetch** (filter change, pagination): existing content dims with a translucent overlay and centered spinner, preventing layout shift and context loss
  - Pages updated: `/dashboard`, `/dashboard/search`, `/dashboard/projects`, `/dashboard/alerts`, `/dashboard/errors`, `/dashboard/traces`, `/dashboard/security`, `/dashboard/security/incidents`, `/dashboard/admin/organizations`, `/dashboard/admin/users`, `/dashboard/admin/projects`, `/dashboard/settings/members`
  - Automated Helm chart releases: every stable Docker image release now triggers a `repository_dispatch` to `logtide-dev/logtide-helm-chart`, which auto-bumps `appVersion` and chart `version` (patch), commits, and publishes a new chart release to the Helm repo on GitHub Pages

### Fixed
- API 400 responses now include a `details` array with field-level validation errors instead of just a generic message. Covers both Fastify/AJV schema validation and Zod validation errors (including uncaught `ZodError` that previously returned 500)
- Admin pages returned 502 Bad Gateway on direct load/reload: the admin layout (`+layout@.svelte`) breaks out of the dashboard layout chain, so `ssr = false` was not inherited; added a dedicated `+layout.ts` to the admin section
- `/dashboard/admin/projects/[id]` crashed with "Something went wrong" due to `formatDate` being called but not defined (function was named `formatTimestamp`)
- `POST /api/v1/logs/identifiers/batch` slow: the route was calling `reservoir.getByIds` (hitting ClickHouse/TimescaleDB/MongoDB) only to verify project access, then querying `log_identifiers` (PostgreSQL) separately. Since `log_identifiers` already stores `log_id → project_id` + identifier data, the storage engine call is now bypassed entirely - one PostgreSQL query replaces the N×storage-engine-roundtrips loop. Added bloom filter skip index on `id` in ClickHouse and a standalone `id` index in TimescaleDB (migration 032) for `getByIds` used by `findCorrelatedLogs`
- `GET /api/v1/logs/hostnames` taking 8+ seconds: the 6h window cap was only applied when `from` was absent - explicit `from` params (e.g. 24h range from the search page) bypassed it and triggered a full-range metadata scan; cap now clamps any window to 6h max. Added `limit: 500` to the distinct call. Per-engine optimizations: **ClickHouse** adds a `hostname` materialized column (computed at ingest, eliminates `JSONExtractString` at query time) and uses it directly in distinct queries; **TimescaleDB** adds a composite expression index `(project_id, (metadata->>'hostname'), time)` (migration 032); **MongoDB** adds a sparse compound index on `metadata.hostname`. All three engines also now extract the metadata field in a subquery (once per row vs 3×)

## [0.8.3] - 2026-03-18

### Added
- **Comprehensive Audit Logging**: major expansion of the audit trail system to cover all critical platform actions for improved compliance (GDPR/SOC2) and security monitoring.
  - **Log Access Auditing**: every log search, trace view, context lookup, single log detail view, and live stream connection is now recorded with user identity, IP address, and query parameters.
  - **External Authentication Auditing**: successful logins via OIDC and LDAP providers are now tracked, including new user registration events.
  - **Identity Management Auditing**: linking and unlinking of external identities (Google, GitHub, LDAP, etc.) to user accounts is now recorded.
  - **Authentication Provider Auditing**: all administrative actions on auth providers (create, update, delete, reorder) are now fully audited with configuration change summaries.
  - **System Settings Auditing**: any changes to global platform settings (auth mode, signup status, default users) are now tracked with before/after metadata.
  - **Session Auditing**: viewing of active session lists and individual session event timelines is now recorded.
  - Audit metadata now includes detailed context like search queries (`q`), filter parameters, and updated keys for configuration changes.
- OIDC login page now shows brand icons for well-known providers (Google, Microsoft/Azure, GitHub, GitLab, Okta, Auth0, Keycloak, Authentik); unknown providers fall back to the generic icon
- Backend auto-detects the provider icon from the issuer URL when creating or updating an OIDC provider, with name/slug matching as fallback for self-hosted setups

### Fixed
- Date and number formatting localization: removed hardcoded locales (`it-IT`, `en-US`) from the frontend (SIEM, Search, Admin, etc.) to ensure the application automatically respects the user's browser/system language settings.
- `GET /api/v1/projects/data-availability` returned `logs: []` (and incorrect traces/metrics) when `STORAGE_ENGINE=clickhouse` or `mongodb`; the endpoint now routes all three checks through the reservoir so they hit the correct backend

## [0.8.2] - 2026-03-16

### Fixed
- Admin pagination: `limit` is now capped at 200, preventing oversized result set allocation
- NDJSON ingestion: lines exceeding 1MB are now rejected with HTTP 400
- Log metadata: `api_key_id` no longer stored in log metadata (information disclosure)

### Added
- SigmaHQ rules now auto-sync daily at 2:30 AM for organizations with existing community rules
- Log detail panel: "View Trace →" link navigates directly to the trace timeline when a `trace_id` is present
- Audit log entries for alert rule create, update, and delete operations

## [0.8.1] - 2026-03-15

### Added

- **Project visibility in Exceptions**: The `/dashboard/errors` list and the individual error group detail pages now explicitly display the name of the project that generated the error.
- **API Key visibility in Exception logs**: The recent logs tab within an error group detail page now displays the specific API Key name used to ingest the log. Ingestion now injects the `api_key_id` into log metadata.

### Fixed

- **Project data-availability ignoring storage engine**: `GET /api/v1/projects/data-availability` was always querying the PostgreSQL `logs` table via Kysely, returning `logs: []` when `STORAGE_ENGINE` was set to `clickhouse` or `mongodb`. The logs check now uses `reservoir.distinct()` which routes to the correct storage backend.
- **Search page showing no projects when `logs` is empty array**: the project filter guard `logsProjectIds ?` was truthy for `[]`, filtering out all projects. Changed to `logsProjectIds?.length` so an empty array correctly falls back to showing all projects.

## [0.8.0] - 2026-03-14

### Added

- **Browser & Frontend SDK Enhancements** (#156): Sentry-level browser observability across all frontend framework SDKs
  - **`@logtide/browser` package**: new dedicated browser SDK with session tracking, Web Vitals, rich breadcrumbs, and offline resilience
  - **Session context**: per-tab `session_id` via `sessionStorage` + in-memory cache, wired through full stack (SDK → backend column → reservoir → UI filter)
  - **Core Web Vitals**: automatic LCP, INP, CLS collection via `web-vitals` library with configurable sampling rate
  - **Click breadcrumbs**: event-delegation-based click/input tracking with `data-testid` capture, debounced inputs, never captures values
  - **Network breadcrumbs**: monkey-patched `fetch` + `XMLHttpRequest` recording method/URL/status/duration, query param stripping by default, configurable deny list
  - **Offline resilience**: `OfflineTransport` wrapper that buffers logs/spans during connectivity loss (bounded queue), flushes on reconnect, `sendBeacon` on page unload
  - **Source maps**: `@logtide/cli` with `logtide sourcemaps upload` command, backend storage/un-minification service, original file/line/column/function in stack frames, frontend toggle between minified and original frames
  - **Framework improvements**:
    - Next.js: RSC error detection (`mechanism: 'react.server-component'`), route params from `__NEXT_DATA__` in navigation breadcrumbs
    - Nuxt: `logtidePiniaPlugin` for Pinia action breadcrumbs
    - SvelteKit: route context in `handleError`, `createBoundaryHandler()` for `<svelte:boundary>`
    - Angular: NgZone context detection (`angular.zone: 'inside'/'outside'`) in error handler
  - **Project-scoped dashboard**: Overview tab for all projects, auto-detected Performance and Sessions tabs for browser SDK projects
  - **Capabilities API**: `GET /api/v1/projects/:id/capabilities` auto-detects `hasWebVitals` and `hasSessions` from recent data
  - Backend: migrations 029-031, `session_id` column on logs, `sourcemaps` table, `original_*` columns on `stack_frames`
  - SDK: 212 tests across 8 packages (browser: 41, core: 111, nextjs: 17, nuxt: 7, sveltekit: 20, angular: 7, cli: 9)

- **Metrics Dashboard & Rollups** (#150): first-class metrics experience with pre-aggregated rollups and multi-panel dashboard
  - Redesigned metrics page with **Overview** and **Explorer** tabs
  - Overview panel: service-grouped metric cards with sparkline charts (ECharts), latest/avg/min/max values
  - Pre-aggregated rollups for fast dashboard queries:
    - TimescaleDB: `metrics_hourly_stats` and `metrics_daily_stats` continuous aggregates with refresh policies
    - ClickHouse: `metrics_hourly_rollup` and `metrics_daily_rollup` materialized views
    - MongoDB: on-the-fly aggregation pipeline (no materialized views needed)
  - Smart rollup routing: auto-detects eligible queries (1h/1d interval, compatible aggregation) and falls back to raw table
  - `GET /api/v1/metrics/overview` endpoint with `serviceName` filter
  - `serviceName` filter added to `/aggregate` endpoint
  - Cross-signal correlation: click chart data point → navigate to traces with time window
  - Project selector in metrics header for quick switching
  - `ServiceSelector` component with service dropdown and segmented time range buttons
  - `MetricCard` component with type badge and ECharts sparkline
  - `OverviewPanel` component with per-service metric groups and cross-links to traces/logs
  - Frontend API client and store extended with overview support
  - 13 new reservoir tests (rollups + overview) across TimescaleDB and ClickHouse engines

- **Smart Project Selectors**: project dropdowns now only show projects that have data in the relevant category
  - `GET /api/v1/projects/data-availability` endpoint returns per-category project IDs (logs, traces, metrics)
  - Metrics page filters to projects with metrics data
  - Traces page filters to projects with traces data
  - Search page filters to projects with logs data
  - Graceful fallback to all projects if availability check fails

- **MongoDB Storage Adapter** (#157): full MongoDB backend for the `@logtide/reservoir` storage abstraction layer
  - All 33 `StorageEngine` methods implemented (logs, spans, traces, metrics, exemplars)
  - `MongoDBQueryTranslator` extending abstract `QueryTranslator` for filter/query translation
  - `EngineType` union extended: `'timescale' | 'clickhouse' | 'mongodb'`
  - Factory support with `createStorageEngine('mongodb', config)` and client injection
  - Sub-path export `@logtide/reservoir/mongodb`
  - Docker Compose profile-gated MongoDB 7.0 service
  - Backend `getMongoDBConfig()` with URI parsing and `authSource` support
  - MongoDB health check in admin service
  - Frontend admin dashboard updated for 3-engine support (TimescaleDB/ClickHouse/MongoDB)
  - 34 unit tests + 66 integration tests (100 total)

- **Golden Signals with Percentiles** (#163): P50/P95/P99 percentile aggregation across all storage engines
  - New `percentile` aggregation function for TimescaleDB, ClickHouse, and MongoDB engines
  - Golden Signals panel with dedicated charts (request rate, error rate, latency percentiles)
  - Metrics E2E tests

- **Reservoir Benchmark Suite**: comparative benchmarking framework for storage engines
  - k6-based benchmark scripts for ingestion and query workloads
  - Support for TimescaleDB, ClickHouse, and MongoDB engines
  - Seeding scripts with configurable batch sizes (up to 100k)

- **Custom Time Range Picker**: custom time range support in TimeRangePicker synced with URL parameters

- **DSN Copy in API Key Dialog**: copy the DSN connection string (`https://KEY@host`) directly when creating an API key, for quick SDK setup

- **Error Boundaries**: layout-level error boundaries for improved error handling and recovery

### Security

- Validate redirect URLs and sanitize release paths to prevent open redirect attacks
- Bump fastify (security patch)

### Optimized

- **Batch ingestion**: `insertMany({ordered: false})` for maximum write throughput
- **Connection pool**: tuned `maxPoolSize: 100`, `minPoolSize: 5`, `maxIdleTimeMS: 60s`
- **Index strategy**: compound indexes matching query patterns, sparse indexes for nullable fields
- **Atomic trace upsert**: single `bulkWrite` with `$min/$max/$inc/$setOnInsert` (1 network round trip)
- **Auto-detect MongoDB 5.0+ features**: `$dateTrunc` for time bucketing, time-series collections
- **Client-side join** for service dependencies (O(n) Map vs O(n²) `$lookup`)
- **Parallel metric + exemplar ingestion**: `Promise.all` for independent collection inserts
- **Smart search**: `$text` index for clean terms, regex fallback for special characters
- **Cursor-based keyset pagination**: `time,id` tuples for consistent pagination
- **`limit+1` pattern**: detect `hasMore` without extra count query
- **Single-element `$in` avoidance**: exact match for single values, `$in` only for arrays
- **ClickHouse projections** for faster query execution, reduced `max_threads` to 2
- **Parallelized trace upserts** in span seeding (500 concurrent)
- **Optimized ClickHouse and MongoDB engine settings** for production workloads

### Fixed

- **Internal Logging Plugin**: fixed bug where `INTERNAL_DSN` was not passed to the `@logtide/fastify` plugin, preventing self-monitoring logs.
- **Backend Self-Monitoring**:
  - Improved DSN construction to automatically use `http://backend:8080` when running in Docker.
  - Added verbose logging at startup to show the connection status for internal logging.
  - Reduced batching and flush intervals for near real-time self-monitoring.
- **Docker Compose Configuration**:
  - Added missing `LOGTIDE_DSN` and `PUBLIC_LOGTIDE_DSN` to the frontend service.
  - Added `INTERNAL_DSN`, `FRONTEND_URL`, and `DOCKER_CONTAINER=true` to backend and worker services.
  - Corrected `worker` service configuration (moved environment variables from healthcheck block and fixed `SERVICE_NAME`).
- **Protocol Mismatch**: clarified requirement for `http` protocol in DSN when targeting local instances without SSL.
- Admin chart missing metrics and live tail search filtering

### Optimized

- **Project Capabilities Detection**: reduced scanning range from 7 days to 24 hours and optimized queries for Web Vitals and Sessions, making the initial dashboard load instant.
- **Dashboard Performance**: implemented a multi-engine intelligent optimization strategy that makes project dashboards instant even with millions of logs.
- **TimescaleDB Skip-Scan**: implemented Recursive CTEs for `distinct` queries, reducing execution time from minutes to milliseconds on high-cardinality fields like `service`.
- **Intelligent Volume Estimation**: all engines now support `countEstimate`, allowing the dashboard to bypass heavy operations on high-volume projects.
- **MongoDB Protection**: added safe timeouts and fallback logic for count operations on massive collections.
- Golden signals: pass serviceName + attributes filter, parallelize fetches
- ClickHouse `getMetricsOverview` alias collision
- Sessions query using proper parameterized SQL
- Timeline events project scoping and derived pattern
- Web vitals widget missing projectId
- Fluent Bit: `body_key` requires `headers_key` in HTTP output
- Fluent Bit metrics config comment parsing error
- Hardcoded API URL in API key dialog curl example now uses detected host

## [0.7.0] - 2026-02-26

### Added

- **OTLP Metrics Ingestion** (#4): complete OpenTelemetry metrics support, closing the observability stack (logs + traces + metrics)
  - `POST /v1/otlp/metrics` endpoint with protobuf and JSON support (gzip compression on both)
  - All 5 OTLP metric types: gauge, sum, histogram, exponential histogram, summary
  - Exemplar support with trace/span correlation (click metric → see related traces)
  - `metrics` + `metric_exemplars` TimescaleDB hypertables with compression (7d) and retention (90d)
  - Full ClickHouse support via reservoir abstraction
  - Query API: `GET /api/v1/metrics/names`, `/labels/keys`, `/labels/values`, `/data`, `/aggregate`
  - 7 aggregation intervals (1m–1w) and 6 aggregation functions (avg, sum, min, max, count, last)
  - Group-by label support for multi-series visualization
  - Svelte store + API client ready for frontend integration
  - 118+ tests covering ingestion, transformation, query, and both storage engines

- **Service Dependency Graph & Correlation Analysis** (#40): dedicated service map visualizing microservice interactions
  - Force-directed graph (ECharts) built from span parent-child relationships + log co-occurrence analysis
  - Enriched backend endpoint `GET /api/v1/traces/service-map` runs 3 parallel queries: span deps (reservoir), per-service health stats (continuous aggregates), log co-occurrence (trace_id self-join)
  - Health color-coding on nodes: green (<1% errors), amber (1-10%), red (>10%)
  - Click-to-inspect side panel showing error rate, avg/p95 latency, total calls, upstream/downstream edges
  - Dashed edges for log correlation, solid for span-based dependencies
  - PNG export, time range filtering, project picker

- **Audit Log**: comprehensive audit trail tracking all user actions across the platform for compliance and security (SOC 2, ISO 27001, HIPAA)
  - Tracks 4 event categories: log access, config changes, user management, data modifications
  - Logged actions: login, logout, register, create/update/delete organizations, create/update/delete projects, create/revoke API keys, member role changes, member removal, leave organization, admin operations
  - TimescaleDB hypertable with 7-day chunks, automatic compression (30 days), and retention policy (365 days)
  - High-performance in-memory buffer with periodic flush (50 entries or 1s interval) for non-blocking writes
  - Accessible to organization owners and admins via Organization Settings
  - Expandable table rows showing full event details: metadata, resource IDs, user agent, IP address
  - Category and action filters
  - CSV export with current filters applied (up to 10k rows)
  - Export actions are themselves audit-logged (meta-meta logging)

### Changed

- **Batch ingestion endpoint**: `POST /api/v1/ingest` now accepts flexible payload formats for better collector compatibility (Vector, Fluent Bit, etc.)
  - Standard format: `{"logs": [{...}]}` (unchanged)
  - Direct array: `[{log1}, {log2}]` (Vector with `codec: json`)
  - Wrapped array: `[{"logs": [{...}]}, ...]` (Vector with VRL wrapping)
  - Array formats auto-normalize fields via `normalizeLogData` (auto-generates `time`, normalizes `level`, extracts `service`)

- **UX Restructuring**: major navigation and page layout overhaul for better discoverability
  - **Sidebar grouped into sections**: Observe (Logs, Traces, Metrics, Errors), Detect (Alerts, Security), Manage (Projects, Settings) - replaces flat 11-item list
  - **Service Map merged into Traces**: list/map view toggle on the Traces page instead of a separate route
  - **Sigma Rules moved to Security**: Security page now has sub-nav with Dashboard, Rules, Incidents tabs - Alerts page simplified to just Alert Rules and History
  - **Project pages simplified**: removed duplicate log viewer (937 LOC deleted), added "View Logs" button that navigates to global search with project pre-filtered
  - **Settings restructured**: sub-navigation with General, Security & Data, Notifications, Team, Administration sections
  - **Command palette updated**: all 9 main pages accessible with keyboard shortcuts (`g d`, `g s`, `g t`, `g m`, etc.)

### Fixed

- **Admin Dashboard Missing Metrics**: Platform Activity chart now includes a Metrics series alongside Logs, Detections, and Spans, querying `metrics_hourly_stats` continuous aggregate for OTLP metric data points
- **Live Tail Search Filtering**: incoming logs via WebSocket are now filtered client-side against the active search query, trace ID, and session ID filters - previously live tail showed all incoming logs regardless of search criteria
- **OTLP Traces Ingestion**: fixed a critical typo in trace transformation where `resource_logs` was used instead of `resource_spans`, preventing proper parsing of OTLP/JSON traces.
- **OTLP Authentication**: fixed `authPlugin` to correctly handle `/v1/otlp` routes, allowing API Key authentication without requiring a valid user session.
- **LogTide JavaScript SDKs**: updated `@logtide/core`, `@logtide/fastify`, and `@logtide/sveltekit` to version `0.6.1` for improved OTLP compatibility and TraceID/SpanID serialization.
- **Frontend Environment Loading**: fixed DSN loading in SvelteKit by using `$env/dynamic/public` and added Vite proxy for `/v1/otlp` to avoid CORS issues in development.
- **LogTide SDK patterns update**: Updated all code examples in the dashboard, empty states, and onboarding flow to use the latest patterns from the `logtide-javascript` and `logtide-sdk-python` repositories.
  - Node.js examples now use `@logtide/core` with `hub.init()` and `hub.captureLog()` pattern.
  - Python examples now use the `logtide` package with `LogTideClient` and `client.info()` / `client.error()` methods.
  - Added correct Go OpenTelemetry examples in the Traces empty state.
- **Frontend warning cleanup**: eliminated all 46 TypeScript and Svelte compiler warnings across the codebase (26 unused imports/variables, 4 deprecated `<svelte:component>` usages, 7 a11y label warnings, 2 non-reactive bindings, and miscellaneous Svelte 5 migration issues)
- **Pagination total count**: search and incidents pages now show total count ("Showing 1 to 25 of ~1,234 logs") instead of incrementing per-page - logs use fast approximate count via EXPLAIN planner estimates (no full table scan), incidents use exact COUNT(*); stale cache entries with missing totals are automatically invalidated
- **Admin dashboard timeline gaps (ClickHouse)**: periodic drops to zero in Platform Activity chart caused by bucket key format mismatch - ClickHouse produced ISO timestamps (`2026-02-26T13:00:00.000Z`) while PostgreSQL produced text format (`2026-02-26 13:00:00+00`), preventing merge; now all bucket keys are normalized to ISO format and all 24 hourly buckets are pre-filled to eliminate gaps
- **Chart locale**: timestamps no longer hardcoded to Italian locale - charts now respect user's system language
- **Silent API errors**: search and traces pages now show error toasts when data loading fails
- **Empty states**: added "No services yet" and "No errors yet" empty states to dashboard widgets
- **Docker initialization**: database is now auto-created if it doesn't exist during startup

### Removed

- Dead code cleanup: unused `Navigation.svelte` component, duplicate log viewer in project pages, unreachable code paths

---

## [0.6.4] - 2026-02-26

### Changed

- **Batch ingestion endpoint**: `POST /api/v1/ingest` now accepts flexible payload formats for better collector compatibility (Vector, Fluent Bit, etc.)
  - Standard format: `{"logs": [{...}]}` (unchanged)
  - Direct array: `[{log1}, {log2}]` (Vector with `codec: json`)
  - Wrapped array: `[{"logs": [{...}]}, ...]` (Vector with VRL wrapping)
  - Array formats auto-normalize fields via `normalizeLogData` (auto-generates `time`, normalizes `level`, extracts `service`)

---

## [0.6.3] - 2026-02-22

### Fixed

- **Unauthenticated SMTP support**: SMTP email notifications no longer require `SMTP_USER` and `SMTP_PASS` - unauthenticated SMTP servers (e.g. port 25) now work correctly by only setting `SMTP_HOST`
  - `isSmtpConfigured()` now only checks for `SMTP_HOST`
  - All email transporters (alerts, incidents, errors, invitations, notification channels) conditionally include `auth` only when credentials are provided
  - `from` address now always uses `SMTP_FROM` instead of falling back to `SMTP_USER`
  - Updated `.env.example` docs to clarify that `SMTP_USER` and `SMTP_PASS` are optional

---

## [0.6.2] - 2026-02-20

### Added

- **Write-Only API Keys**: API keys now have a `type` field (`write` or `full`) to support client-side usage safely
  - `write` keys can only ingest logs - safe to expose in browsers, mobile apps, and frontend code
  - `full` keys can ingest and query - intended for server-side use only
  - New keys default to `write` type
  - Existing keys migrated to `write` type (breaking change - use `full` type for keys that need read access)
  - Key type displayed as badge in project settings API keys table
  - Key type selector in Create API Key dialog

- **Domain/IP Allowlist for API Keys**: Optional restriction on which origins or IPs can use an API key
  - Configure allowed domains, wildcard subdomains (`*.example.com`), or IP addresses per key
  - Browser requests validated against `Origin` header hostname
  - Server requests validated against request IP
  - Empty allowlist means no restrictions (default)
  - Up to 50 allowed origins per key

### Changed

- **Dogfooding SDK Migration**: Replaced `@logtide/sdk-node` with the official framework SDKs for self-monitoring
  - **Backend**: Now uses `@logtide/fastify` plugin for automatic HTTP request/response/error logging, per-request scoping, and W3C Trace Context propagation
  - **Worker**: Now uses `hub` from `@logtide/core` directly (`hub.captureLog()` / `hub.captureError()`) for job event logging
  - **Frontend (new)**: Added `@logtide/sveltekit` for both server-side and client-side self-monitoring
    - `hooks.server.ts`: `logtideHandle()` for SSR request tracing, `logtideHandleError()` for server errors, `logtideHandleFetch()` for distributed trace propagation on outgoing fetches
    - `hooks.client.ts`: `initLogtide()` for client-side hub initialization, `logtideHandleError()` for browser error capture
  - DSN configuration: `INTERNAL_DSN` env var takes priority, falls back to constructed DSN from `INTERNAL_API_KEY` + `INTERNAL_LOGGING_API_URL` via bootstrap
  - Frontend DSN: `LOGTIDE_DSN` (server-side) and `PUBLIC_LOGTIDE_DSN` (client-side browser)
  - Removed custom `internal-logging-plugin.ts` request/response hooks - replaced entirely by `@logtide/fastify` lifecycle hooks
  - Removed `getInternalLogger()` / `LogTideClient` pattern - replaced by `hub.captureLog()` singleton from `@logtide/core`

### Security

- **fast-xml-parser DoS vulnerability**: Bumped override to `>=5.3.6` to fix entity expansion DoS in DOCTYPE (CVE in versions >= 4.1.3, < 5.3.6)
- **Read endpoint protection**: All query, traces, dashboard, correlation, and stats endpoints now reject write-only API keys with 403 Forbidden
- **Origin allowlist validation**: Wildcard subdomain matching correctly parses URL hostnames from browser Origin headers

### BREAKING CHANGES

- **API key default type changed to `write`**: All existing API keys are migrated to write-only. If you have server-side integrations that query logs via API key, update those keys to `full` type in project settings. Client-side ingestion keys continue to work unchanged.
- **Database migration required**: Run migration `024_api_key_scopes.sql` which adds `type` and `allowed_origins` columns to `api_keys` table.

---

## [0.6.1] - 2026-02-14

### Added

- **ClickHouse Storage Engine**: Full ClickHouse support as an alternative to TimescaleDB
  - New `@logtide/reservoir` package - pluggable storage abstraction with a unified API for both engines
  - Factory pattern: `StorageEngineFactory.create('timescale'|'clickhouse', config)` for engine selection
  - Engine configured via `STORAGE_ENGINE` environment variable (`timescale` or `clickhouse`)
  - ClickHouse-specific optimizations: `PREWHERE` clauses, `async_insert`, `ngrambf_v1` indexes for full-text search
  - TimescaleDB-specific optimizations: `UNNEST` batch inserts, `pg_trgm` trigram indexes, connection pool error handling
  - Span and trace ingestion support on both engines
  - 26 integration tests running against both engines via Docker

- **Full Log Query Migration to Reservoir**: All log operations now go through the storage abstraction layer
  - Migrated: query, alerts, dashboard, admin, retention, baseline calculator, ingestion, correlation
  - Engine-type branching for continuous aggregates (TimescaleDB fast path, ClickHouse raw fallback)
  - Added `topValues`, `fromExclusive`/`toExclusive` bounds, and `getEngineType()` to reservoir API
  - Conditional `drop_chunks` for retention (TimescaleDB only)

### Fixed

- **Log Context upper bound**: `getLogContext` "after" query was using `new Date()` as upper bound, which excluded future-timestamped logs

### Performance

- **Slow admin queries on large datasets**: Removed `COUNT(*)` full scans, switched to continuous aggregates, reduced default time windows, added caching
- **ClickHouse query engine**: DateTime64(3) handling for correct millisecond precision, `hasToken()` fallback to `positionCaseInsensitive()` for needles with special characters
- **TimescaleDB engine**: Removed redundant `idx_project_time` index, added `span_id` index, UNNEST-based batch inserts
- **ClickHouse engine**: Removed `LowCardinality` on `project_id`, added `span_id` index, `IS NOT NULL` parity with TimescaleDB, empty array validation guards

### Tests

- Added platform timeline and active issues endpoint tests
- Added reservoir integration tests: `topValues`, exclusive bounds, span/trace operations (both engines)

---

## [0.6.0] - 2026-02-12

### Added

- **Host Security Detection Packs**: 3 new pre-built detection packs for host-based security monitoring (15 rules total, all MITRE ATT&CK mapped)
  - **Antivirus & Malware Pack** (`antivirus-malware`): Malware detection (ClamAV FOUND patterns), AV scan failures, webshell in web directories (compound condition), outdated virus signatures, quarantine/removal failures
  - **Rootkit Detection Pack** (`rootkit-detection`): Rootkit identification (rkhunter/chkrootkit), hidden processes, system binary tampering (checksum mismatch), suspicious kernel modules, promiscuous network interfaces
  - **File Integrity Monitoring Pack** (`file-integrity`): Critical system file changes (/etc/passwd, /etc/shadow, /boot), SSH config modifications, web directory file changes, cron job tampering, mass file changes (ransomware indicator)
  - All rules use `logsource.product: linux` for proper scoping
  - Compound conditions (`selection_malware and selection_path`) on webshell and FIM rules to reduce false positives
  - Integration test script (`testing-scripts/host-security-packs-test.ts`) with 28 assertions covering enable/disable lifecycle, sigma rule generation, MITRE mapping, log ingestion, and cleanup

### Fixed

- **Sigma API missing tags and MITRE fields**: `getSigmaRules` (list) and `getSigmaRuleById` (detail) were not including `tags`, `mitreTactics`, and `mitreTechniques` in the camelCase response transformation - fields were stored correctly in the DB but silently dropped from API responses. Also fixed the same gap in `importSigmaRule` return value.

- **Keyboard Shortcuts for Power Users** (#42): Comprehensive keyboard shortcuts system for faster navigation and actions
  - **Command Palette** (`Ctrl/Cmd+K`): Fuzzy search over pages and quick actions (toggle sidebar, reload, toggle theme, show shortcuts). Search trigger button with shortcut hint in the header
  - **Help Modal** (`?`): Grouped list of all available shortcuts with platform-aware key display (⌘ on Mac, Ctrl on Windows)
  - **Sequence Navigation** (`G then D/S/A/P/T/E/R/X`): GitHub-style two-key navigation to Dashboard, Logs, Alerts, Projects, Traces, Security, Errors, Settings
  - **Search Page Shortcuts**: `/` focus search input, `J/K` navigate logs with visual highlight, `Enter` expand/collapse selected log, `R` refresh results
  - **Dashboard Shortcuts**: `R` refresh dashboard data
  - **Global Shortcuts**: `Ctrl/Cmd+/` go to search / focus search input, `Ctrl/Cmd+B` toggle sidebar, `Escape` close modals
  - **Discoverability**: First-time toast notification, shortcut hints in command palette items, `⌘K`/`Ctrl+K` badge in header
  - Input-aware: shortcuts suppressed when typing in inputs, textareas, or comboboxes

- **Admin Dashboard Revision**: Complete redesign of the admin panel for platform-level observability
  - **Dashboard home**: 4 health status cards (system health, ingestion rate, active issues, total logs), platform activity chart (24h timeline of logs/detections/spans), 8 stat cards (users, orgs, projects, ingestion, alerts, queues, database, redis), top organizations and projects tables
  - **System Health page** (`/dashboard/admin/system-health`): Database/connection pool/Redis diagnostics, database tables overview, TimescaleDB compression stats with progress bars, continuous aggregates health with staleness indicators, storage & performance metrics, worker queue details
  - **Slow queries monitoring**: Active running queries table (from `pg_stat_activity`) with duration color-coding, historical slowest queries table (from `pg_stat_statements` when available)
  - **Platform timeline chart**: ECharts area chart with 3 series (logs, detections, spans) using continuous aggregates for fast queries
  - 5 new backend endpoints: `platform-timeline`, `active-issues`, `compression`, `continuous-aggregates`, `slow-queries`

- **PII Masking at Ingestion**: Automatic detection and masking of sensitive data in log entries before storage (GDPR-compliant, data never touches disk unmasked)
  - **Phase 1 - Content patterns**: Built-in regex rules for email, credit card, phone (US), SSN, IPv4, API keys/secrets
  - **Phase 2 - Field name masking**: Scans metadata JSON keys (`password`, `token`, `secret`, `authorization`, etc.) and masks their values
  - **Phase 3 - Custom rules**: Users can define org-level or project-level regex patterns and field name lists
  - Three masking strategies: `mask` (partial - `u***@domain.com`), `redact` (full - `[REDACTED_EMAIL]`), `hash` (SHA-256 with per-org salt - `[HASH:abc123...]`)
  - REST API: `GET/POST/PUT/DELETE /api/v1/pii-masking/rules` + `POST /api/v1/pii-masking/test`
  - Settings UI at `/dashboard/settings/pii-masking` with rule management, enable/disable switches, action dropdowns, and live test panel (before/after preview)
  - Built-in rules disabled by default - users opt-in per rule from the UI
  - Project-level rules override org-level rules with the same name
  - Database migration `021_add_pii_masking` (`pii_masking_rules` + `organization_pii_salts` tables)

- **Timeline Event Markers**: Visual indicators on the Logs Timeline chart showing when alerts or security detections occurred
  - Scatter circle markers overlaid on the existing chart at matching hourly buckets
  - Red circles for alert triggers, purple for security detections, larger when both in same hour
  - Hover tooltip shows alert rule names, log counts, and detection severity breakdown
  - "Events" toggle in legend to show/hide markers
  - Backend endpoint `GET /api/v1/dashboard/timeline-events` queries `alert_history` + `detection_events_hourly_stats` (with raw fallback)
  - Graceful degradation: chart unchanged when no events exist

- **Rate-of-Change Alerts**: Baseline-based anomaly detection that compares current log volume against historical patterns, triggering when deviation exceeds a configurable multiplier
  - **4 baseline methods**: `same_time_yesterday`, `same_day_last_week`, `rolling_7d_avg` (default), `percentile_p95` - all computed on-the-fly from `logs_hourly_stats` continuous aggregate
  - **Anti-spam**: Sustained check (configurable minutes before firing), cooldown period (default 60min), minimum baseline value guard (ignores low-traffic noise)
  - **Smart defaults**: 3x deviation multiplier, 10 min baseline, 60min cooldown, 5min sustained check
  - Frontend: Alert type toggle (Threshold / Rate of Change), baseline method picker with descriptions, deviation multiplier slider, collapsible advanced settings (min baseline, cooldown, sustained)
  - History display: "Anomaly" badge for rate-of-change alerts, baseline metadata (current rate vs baseline, deviation ratio, method used)
  - Email subject line: `[Anomaly] rule - Nx above baseline` (vs `[Alert]` for threshold)
  - Webhook payload includes `baseline_metadata` and `event_type: "anomaly"` for rate-of-change alerts
  - Zod validation: rate-of-change requires `baselineType` + `deviationMultiplier`, multiplier range 1.5–20
  - Database migration `022_add_rate_of_change_alerts` (adds columns to `alert_rules` + `baseline_metadata` JSONB to `alert_history`)
  - 19 new tests (routes, baseline calculator, service dispatching, validation) - 105 total alert tests passing

- **Version Update Notifications**: Admin dashboard banner that checks GitHub releases for new versions
  - Backend endpoint `GET /api/v1/admin/version-check` proxies GitHub Releases API with 6-hour cache (via CacheManager)
  - Compares current `package.json` version against latest stable and beta releases using semver
  - Release channel setting (`stable` / `beta`) configurable from Admin Settings page, persisted as `updates.channel` in `system_settings`
  - Blue "Update available" banner with version comparison and direct link to release, or green "Up to date" indicator
  - Dynamic version in `/health` endpoint (replaced hardcoded string with `package.json` read)

### Fixed

- **UI layout fixes**: Fixed Badge components stretching to fill container width in alert history detection cards and other grid layouts

- **Client errors returning 500 instead of 4xx**: Multiple API routes were returning Internal Server Error for invalid client input
  - Global error handler now detects Fastify validation errors (`FST_ERR_VALIDATION`) as 400 even when `statusCode` is missing
  - SIEM routes (10 endpoints): `z.parse()` failures were caught as 500 - now return 400 with validation details
  - Exceptions routes (8 endpoints): same `z.parse()` pattern - now return 400
  - OTLP content-type parsers: gzip decompression errors now set `statusCode: 400` instead of falling through to 500
  - Retention route: fixed `error.name === 'ZodError'` check to use `instanceof` for reliability

- **Log Context metadata expanding dialog infinitely**: Opening metadata in the Log Context dialog caused horizontal overflow, stretching the dialog indefinitely. Added `max-w-full` to `<pre>` blocks and `overflow-hidden` to log entry containers so metadata scrolls within its bounds

- **Email logo not rendering in some clients**: Switched logo URLs from `.svg` to `.png` - many email clients (Outlook, Gmail) don't support SVG in `<img>` tags

- **Client errors (4xx) logged as ERROR**: The `onError` hook in the internal logging plugin was logging all errors at `error` level regardless of status code - a 415 Unsupported Media Type would appear as a critical error in the dashboard. Now 4xx errors are logged as `warn`, 5xx as `error`. Also added `skipPaths` to the `onError` hook to avoid logging noise from ingestion endpoints.

- **Continuous Aggregates showing "Refresh: unknown"**: Fixed backend query reading `schedule_interval` from JSONB `config` field instead of the direct column on `timescaledb_information.jobs`

- **HealthStats type mismatch**: Frontend had `'up'|'down'` status values while backend uses `'healthy'|'degraded'|'down'`; also missing `pool` property and `'not_configured'` redis status

- **Admin panel consistency fixes**:
  - Added admin guard (`is_admin` check + redirect) to Users, Organizations, and Auth Providers pages - previously only checked server-side
  - Replaced unsafe click-to-confirm delete patterns (3-5s timeout) with proper `AlertDialog` confirmation modals on Projects list, Project detail, and Organization detail pages
  - Replaced browser `confirm()` in Auth Providers with `AlertDialog`
  - Replaced custom overlay modal in Organization detail with standard `AlertDialog` component
  - Fixed `window.location.href` navigation (full page reload) with SvelteKit `goto()` in Organization detail and Project detail pages
  - Fixed Svelte 4 `authStore.subscribe()` pattern in Auth Providers to use reactive `$authStore`

- **Charts not resizing on sidebar toggle**: ECharts instances (LogsChart, TimelineWidget, SeverityPieChart, MitreHeatmap, ServiceMap, PreviewTimeline) stayed at previous size when toggling the sidebar or changing content density - replaced `window.resize` listener with `ResizeObserver` on chart containers

- **Notification click navigating to wrong organization**: Clicking a notification while viewing a different organization led to "not found" errors - now auto-switches to the notification's organization before navigating

### Performance

- **PII masking zero-cost when disabled**: Cache hit is a single `Map.get()` + timestamp check (~0.001ms), returns immediately when no rules are enabled
- **Compiled regex reuse**: Content rules use `lastIndex = 0` reset instead of `new RegExp()` per string - eliminates ~6000 object allocations per 1000-log batch
- **Hot path allocation reduction**: Ingestion path skips path-tracking arrays and template string building (`trackPaths=false`), uses `Object.keys()` instead of `Object.entries()`
- **Credit card regex rewrite**: Replaced greedy `(?:\d[ -]*?){13,19}` (backtracking-prone, false positives on any 13+ digit sequence) with specific pattern matching `XXXX-XXXX-XXXX-XXXX` format or known issuer prefixes (Visa/MC/Amex/Discover)
- **Early exit for simple messages**: Skips all regex evaluation for strings <6 chars or containing only `[a-zA-Z0-9 _-]`
- **In-memory rule cache**: 5-min TTL per org+project combination, invalidated on CRUD operations
- **ReDoS protection**: Custom regex patterns validated with `safe-regex2`, lookahead/lookbehind blocked, quantifiers capped at 100

---

## [0.5.5] - 2026-02-06

### Fixed

- **Detection Category Filter Validation Error**: Fixed `querystring/category must match exactly one schema in oneOf` on `/api/v1/siem/detections`
  - Replaced `oneOf` schema (string | array) with simple `type: array` - Fastify auto-coerces single values to arrays
  - Aligned Zod validation schema to match

### Performance

- **Admin Dashboard 31s → ~1s**: Fixed all admin stats endpoints causing dashboard timeout on 50M+ logs
  - `/api/v1/admin/stats/logs`: Switched to `logs_daily_stats` continuous aggregate for top orgs/projects/per-day (37s → 31ms), `approximate_row_count()` for total (677ms → 56ms)
  - `/api/v1/admin/stats/database`: Replaced 2x `COUNT(*)` full scans with `approximate_row_count()` + `pg_class.reltuples`, single parallel batch (1.4s → 180ms)
  - `/api/v1/admin/stats/performance`: Changed `created_at` filter to `time` for chunk pruning (793ms → 160ms), parallelized all queries
  - All 6 queries per endpoint now run via `Promise.all()` instead of sequentially

- **Error Group Logs Timeout**: Fixed `/api/v1/error-groups/:id/logs` statement timeout on large datasets
  - Added `logs.time` bounds (`firstSeen`/`lastSeen`) to enable TimescaleDB chunk pruning on the hypertable JOIN
  - Removed expensive `COUNT(*)` query - uses `error_groups.occurrence_count` (maintained by trigger) instead
  - Eliminated redundant group fetch (reuses data already loaded for authorization check)

---

## [0.5.4] - 2026-02-06

### Added

- **Detection Pack Category Routing**: Detection pack results now appear in the correct UI section based on category
  - `security` packs → Security/SIEM dashboard (unchanged)
  - `reliability` / `database` packs → Errors page, new "Detections" tab
  - `business` packs → Alerts page, new "Detections" tab
  - Manual/SigmaHQ Sigma rules default to `security` category
  - Added `category` column to `sigma_rules` and `detection_events` tables (migration 020)
  - Security dashboard and incident auto-grouping now scoped to `category = 'security'` only
  - API supports filtering detection events by category

### Fixed

- **Exception Detection for `metadata.error`**: Errors serialized as `{ name, message, stack }` in log metadata are now detected and parsed
  - Previously only `metadata.exception` (structured format) was checked
  - Common Node.js error serialization pattern (`metadata.error.stack`) was being missed entirely
  - Falls back through: `metadata.exception` → `metadata.error.stack` → message text parsing

- **Exception Details Dialog `[object Object]`**: Fixed fallback view rendering `[object Object]` instead of error message
  - When `metadata.error` is a nested object (e.g. `{ name, message, stack }`), the dialog now flattens it
  - Correctly extracts and displays `message`, `stack`, and `name` from nested error objects

- **Onboarding Race Condition**: Fixed `duplicate key` crash when two concurrent requests create onboarding state
  - `getOnboardingState` now uses `INSERT ... ON CONFLICT DO NOTHING` to handle concurrent inserts
  - Re-fetches state after conflict to return the existing record

- **Internal Org Missing Members**: Fixed `@logtide-internal` organization not assigning admin users as members
  - `bootstrapInternalLogging` now inserts owner into `organization_members` when creating the org
  - On every startup, ensures all admin users are members of the internal org

- **Unwanted Email/Webhook Notifications**: Fixed notifications being sent even when no notification channels are configured
  - Legacy `email_recipients` and `webhook_url` fields on alert rules were still being used at dispatch time
  - Notification job now only uses the notification channels system (`notification_channels` table) to determine recipients
  - Legacy fields remain in the database schema but are no longer read during notification processing

- **Email Logo Not Rendering**: Replaced broken base64-encoded logo with hosted SVG URLs
  - Email clients were not displaying the embedded base64 image
  - Logo now served from `https://logtide.dev/logo/dark.svg` (light backgrounds)
  - Removed `logo-base64.txt` and simplified logo module

- **Ingestion JSON Parse Errors Returning 500**: Malformed JSON in ingestion requests now correctly returns 400 Bad Request
  - Added global error handler to propagate `statusCode` from content type parser errors
  - Invalid JSON/NDJSON payloads no longer cause Internal Server Error responses

---

## [0.5.3]  - 2026-02-04

### Added

- **Hostname Filter for Syslog Sources**: See which machine each log comes from (#80)
  - Hostname automatically extracted from `hostname`, `host`, `_HOSTNAME` (journald), or `kubernetes.host`
  - New **Hostnames** filter dropdown in log search page
  - Hostname displayed in log table under service badge (e.g., `nginx @proxmox-node-1`)
  - Click hostname to filter logs from that specific machine
  - New `/api/v1/logs/hostnames` endpoint for distinct hostnames

### Fixed

- **Log Retention on Compressed Chunks**: Fixed retention cleanup not deleting logs from TimescaleDB compressed chunks
  - Retention service now automatically decompresses chunks before deleting old logs
  - Identifies only chunks containing data for the specific organization (not all chunks)
  - Compressed chunks are re-compressed automatically by TimescaleDB's compression policy
  - Fixes issue where per-org retention settings were ignored for data older than `compress_after` interval

- **Fluent Bit Kubernetes Metadata**: Fixed service showing as "unknown" when using Fluent Bit DaemonSet in Kubernetes (#118)
  - Service name now correctly extracted from nested `kubernetes.container_name`
  - Falls back to `kubernetes.labels.app` or `kubernetes.labels['app.kubernetes.io/name']`
  - Full Kubernetes metadata (pod_name, namespace_name, labels) preserved in log metadata
  - No Fluent Bit config changes required - works out of the box

### Performance

- **Database Performance Monitoring**: Major optimizations for large-scale deployments (30M+ logs)
  - **log_identifiers table optimization** (Migration 018):
    - Converted to TimescaleDB hypertable with daily partitioning
    - Enabled automatic compression (80%+ space reduction)
    - Removed 5+ GB of unused indexes (0 scans in production)
    - Filtered out redundant org_id/project_id identifiers (~31% space savings)
    - Expected: 10 GB → 1-2 GB storage, 2-5x faster queries
  - **Continuous aggregates for spans and detection events** (Migration 019):
    - `spans_hourly_stats` / `spans_daily_stats`: Pre-computed P50/P95/P99 latency, error rates per service
    - `detection_events_hourly_stats` / `detection_events_daily_stats`: SIEM dashboard metrics
    - `detection_events_rule_stats`: Top threats query optimization
    - 15 new indexes for aggregate tables
    - Dashboard queries: 10-50x faster (seconds → milliseconds)
  - **Hybrid query architecture**:
    - Uses aggregates for historical data (>1 hour old)
    - Queries raw tables for recent data (real-time accuracy)
    - Parallel query execution with `Promise.all()`
  - **Admin monitoring endpoints**:
    - `getCompressionStats()`: Per-hypertable compression metrics
    - `getAggregateStats()`: Continuous aggregate health monitoring
  - **Massive data seeding script** (`npm run seed:massive`):
    - Generates 30M logs, 1M spans, 100K detection events
    - Uses PostgreSQL `generate_series` for maximum performance
    - Useful for performance testing and benchmarking

---

## [0.5.2] - 2026-02-03

### Security

- **Fastify Security Vulnerabilities**: Upgraded Fastify from 4.x to 5.7.3+ to fix critical CVEs
  - CVE: Content-Type header tab character allows body validation bypass (fixed in 5.7.2)
  - CVE: DoS via Unbounded Memory Allocation in sendWebStream (fixed in 5.7.3)
  - Updated all @fastify/* plugins to compatible v5 versions

### Fixed

- **API Batch Request Limit**: Fixed `logIds must NOT have more than 100 items` error in log search tail mode
  - `getLogIdentifiersBatch` now automatically splits requests into batches of 100
  - Supports up to 1000 logs in tail mode without errors
  - Batches executed in parallel for performance

- **Unicode Escape Sequences**: Fixed `unsupported Unicode escape sequence` error during log ingestion
  - Sanitizes `\u0000` (null characters) from log data before PostgreSQL insertion
  - Affects message, service, metadata, trace_id, and span_id fields

- **POST Requests Without Body**: Fixed CDN/proxy compatibility issues with empty POST requests
  - `disablePack`: Now sends `organizationId` in request body instead of query string
  - `notification-channels/test`: Now sends `organizationId` in request body
  - `resendInvitation`, `testConnection`, `leaveOrganization`: Now send empty `{}` body
  - Backend routes accept `organizationId` from body or query for backwards compatibility

---

## [0.5.1] - 2026-02-01

### Added

- **Notification Channels**: Configurable notification destinations for alerts and Sigma rules
  - Create and manage multiple notification channels per organization
  - Support for Email (SMTP) and Webhook channel types
  - Link channels to alert rules and Sigma rules
  - Channel testing before saving
  - UI for channel management in settings

### Changed

- **UI Space Optimization**: Maximize content area for better log visibility (#108)
  - Reduced excessive margins and padding around main content
  - Log lines wrap less frequently on standard screens
  - Better use of available screen real estate

### Fixed

- **Invitation Email Resend**: Fixed SMTP invitation resend functionality (#111)
  - Updated invitation API endpoints structure
  - Refactored email generation for invitations

---

## [0.5.0] - 2026-01-31

### Added

- **Terminal Log View**: Alternative terminal-style visualization for logs
  - Toggle between Table and Terminal views in the search page
  - Monospace font with ANSI-style color coding by log level
  - Format: `[timestamp] [LEVEL] [service] message`
  - Full light/dark mode support
  - Auto-scroll with Live Tail integration
  - Text selectable for easy copy/paste
  - View preference persisted in session storage
  - Accessible with ARIA attributes for screen readers

- **Detection Packs**: Pre-configured Sigma rule bundles for common use cases (#88)
  - Gallery dialog to browse and enable detection packs
  - One-click deployment of curated security rules
  - Customization options for pack rules
  - Logsource product set to 'any' for broader applicability

- **Event Correlation**: Link related logs by identifier (#89)
  - Correlate events by `request_id`, `trace_id`, `user_id`, or custom fields
  - Automatic identifier extraction from log metadata
  - UI with loading states and configuration links
  - Click any identifier to find all related logs

- **Alert Preview "Would Have Fired"**: Test alerts before enabling (#91)
  - Preview which logs would trigger an alert rule
  - Analyze historical data to validate alert conditions
  - Dark mode support for preview UI

- **Optional Redis Dependency**: Redis is now optional for simpler deployments (#90)
  - PostgreSQL-based job queues using `graphile-worker` when Redis is unavailable
  - PostgreSQL `LISTEN/NOTIFY` for real-time log streaming (live tail)
  - In-memory rate limiting fallback when Redis is not configured
  - Queue abstraction layer with adapter pattern (BullMQ for Redis, graphile-worker for PostgreSQL)
  - New `docker-compose.simple.yml` for Redis-free deployments
  - Automatic backend selection based on `REDIS_URL` environment variable
  - Graceful degradation: caching disabled, rate limiting in-memory, jobs via PostgreSQL

- **Queue System Architecture**: Unified queue interface supporting multiple backends
  - `IQueueAdapter` and `IWorkerAdapter` interfaces for queue operations
  - `QueueSystemManager` singleton with queue/worker instance caching
  - Proper resource cleanup on shutdown (closes all cached queue/worker instances)
  - Type-safe job processors with `IJob<T>` generic interface

### Changed

- **Configuration**: `REDIS_URL` is now optional
  - If not set, backend automatically uses PostgreSQL alternatives
  - Existing deployments with Redis continue to work unchanged
  - Health check endpoint reports Redis as `not_configured` when unavailable

- **Cache System**: Graceful handling of missing Redis
  - All cache operations return `null` when Redis unavailable
  - No errors thrown, application continues without caching
  - SigmaHQ GitHub client works without Redis (skips caching)

- **Authentication**: Token retrieval refactored to use localStorage

### Fixed

- **Log Context Modal Reopening**: Fixed modal reopening after close when opened via URL params
  - Closing the modal now clears `logId` and `projectId` from URL
  - Prevents effect from re-triggering and reopening the dialog

- **Exception Details from Metadata**: Error info in log metadata now displayed in Exception Details dialog
  - Previously showed "No exception found" when error data was in metadata field
  - Now extracts and displays `stack`, `reason`, `message`, `error` fields from metadata
  - Shows context fields (`env`, `service`, `version`, `hostname`) in a grid
  - Copy button for stack trace
  - Fallback view when no parsed exception exists in database

- **WebSocket Memory Leak**: Fixed potential memory leak in live tail WebSocket handler
  - Added proper socket cleanup in error handler
  - `safeSend` helper prevents sending to closed sockets
  - Race condition fix with `isSocketOpen` tracking

- **SQL Injection Prevention**: Fixed potential SQL injection in notification publisher
  - Removed manual quote escaping, using Kysely parameterized queries

### Documentation

- Updated deployment docs for Redis-optional configuration
- Added `docker-compose.simple.yml` example for minimal deployments

---

## [0.4.2] - 2026-01-15

### Added

- **Clipboard Utility**: Centralized `copyToClipboard` function (#102)
  - Unified copy behavior across all components
  - Proper fallback for older browsers
  - Updated copy functions in API key, log detail, and trace components

- **Config Validation Tests**: Added test coverage for configuration validation

### Fixed

- **Documentation**: Fixed `api_key_secret` in `.env.example`
- **Documentation**: Added `map_syslog_level.lua` download command to README (#96)
- **Documentation**: Fixed OTLP endpoint URLs in docs (#87)
- **Docker**: Added more configuration info in `docker-compose.yml`

---

## [0.4.1] - 2026-01-10

### Added

- **Exception Parsers**: Multi-language stack trace parsing (#84)
  - PHP exception parser with frame extraction
  - Go panic/stack trace parser
  - Node.js Error parser with V8 stack format
  - Python traceback parser
  - Java exception parser with cause chain support
  - Comprehensive test coverage for all parsers

### Changed

- **Dependencies**: Bump @sveltejs/kit (#86)

### Fixed

- **Dependencies**: Update devalue package to 5.6.2
- **OTLP URLs**: Fixed endpoint URLs in ApiKeyStep, EmptyDashboard, and EmptyTraces components

---

## [0.4.0]

### Added

- **Substring Search Mode**: Find text anywhere in log messages (#68)
  - New search mode dropdown in the Logs Search page
  - **Full-text** mode: Word-based search with stemming (default, existing behavior)
  - **Substring** mode: Find partial matches anywhere in messages (e.g., "bluez" in "spa.bluez5.native")
  - Powered by PostgreSQL `pg_trgm` extension with GIN trigram index for fast performance
  - Admin settings to configure default search mode system-wide
  - Search mode preference saved per-session in browser
  - 10 new integration tests for substring search

- **Clickable Dashboard Elements**: Interactive navigation from dashboard (#67)
  - Recent errors, top services, and other dashboard items are now clickable
  - Clicking an item navigates to the corresponding search page with pre-applied filters
  - Improved discoverability and workflow efficiency

- **Enhanced Exception & Stack Trace Visualization**: Better debugging experience (#23)
  - Auto-detect stack traces from multiple languages (Node.js, Python, Java, Go, PHP)
  - Parse traces into structured frames with file, line, function, and column information
  - Syntax highlighting for better readability
  - Exception type badges (e.g., "TypeError", "ValueError")
  - Collapsible frames showing top 3-5 by default
  - Copy functionality for traces and individual frames
  - Error grouping by stack trace fingerprint with frequency tracking

- **Customizable Log Retention Policy**: Per-organization retention settings
  - Configure retention period per organization
  - Admin UI for managing retention policies
  - Background worker for automatic log cleanup

### Changed

- **Project Rebranding**: LogWard renamed to LogTide ([discussion](https://github.com/orgs/logtide-dev/discussions/81))
  - Name change due to trademark conflict with a European supply chain software company
  - New name reflects the platform's mission: "Log" for what we manage, "Tide" for the continuous flow of observability data
  - All references updated across codebase, documentation, and UI

- **Improved Custom Time Range Picker**: Stateful time selection (#72)
  - Custom time range fields now pre-populated with values from recently used presets
  - Previously entered date/time values preserved when switching between preset and custom modes
  - Quick adjustments without complete re-entry of time ranges
  - Better UX for power users who frequently adjust time windows

### Fixed

- **Export All Pages**: Log export now includes all matching logs (#71)
  - CSV and JSON exports previously only captured logs from the current visible page (~25 entries)
  - Export now retrieves all logs matching the current filters across all pages
  - No more manual merging of multiple exports required

### BREAKING CHANGES

Due to the rebrand from LogWard to LogTide, the following changes require action when upgrading:

**Environment Variables (rename in your `.env` file):**
| Old Variable | New Variable |
|-------------|--------------|
| `LOGWARD_PORT` | `LOGTIDE_PORT` |
| `LOGWARD_BACKEND_IMAGE` | `LOGTIDE_BACKEND_IMAGE` |
| `LOGWARD_FRONTEND_IMAGE` | `LOGTIDE_FRONTEND_IMAGE` |

**Fluent Bit Configuration (if using custom config):**
- Internal variables in `fluent-bit.conf` renamed: `${LOGWARD_API_KEY}` → `${LOGTIDE_API_KEY}`, `${LOGWARD_API_HOST}` → `${LOGTIDE_API_HOST}`
- If you're using the default config from the repo, just pull the new version
- The `.env` variable `FLUENT_BIT_API_KEY` remains unchanged

**Database Defaults (only affects new installations):**
- Default database name: `logward` → `logtide`
- Default database user: `logward` → `logtide`
- Existing installations can keep the old names by setting `DB_NAME` and `DB_USER` explicitly

**Docker (update your docker-compose overrides if any):**
- Container names: `logward-*` → `logtide-*` (e.g., `logward-backend` → `logtide-backend`)
- Network name: `logward-network` → `logtide-network`
- Default images: `logward/backend` → `logtide/backend`, `logward/frontend` → `logtide/frontend`
- GHCR images: `ghcr.io/logward-dev/logward-*` → `ghcr.io/logtide-dev/logtide-*`

**Service Names:**
- Internal service names changed from `logward-backend`/`logward-worker` to `logtide-backend`/`logtide-worker`
- This affects logs if you filter by service name

**SMTP Default:**
- Default sender: `noreply@logward.local` → `noreply@logtide.local`
- Override with `SMTP_FROM` if you have a custom sender

**Migration Guide:**
1. Stop your containers: `docker compose down`
2. Update your `.env` file with renamed variables
3. Pull new images: `docker compose pull`
4. Start containers: `docker compose up -d`
5. Data is preserved - no database migration needed

- **Website Separation**: Homepage and documentation moved to dedicated website
  - Landing page and all documentation pages moved to [logtide.dev](https://logtide.dev)
  - App homepage now redirects to `/dashboard` (authenticated) or `/login` (unauthenticated)
  - All internal `/docs` links updated to external `https://logtide.dev/docs`
  - Navbar, Footer, and empty state components updated with external documentation links
  - Cleaner separation between marketing website and application

### Removed

- **Documentation Pages**: Removed 24 documentation pages from the app
  - Getting Started, API Reference, SDK docs (Node.js, Python, Go, PHP, Kotlin, C#)
  - Migration guides (Datadog, Splunk, ELK, Loki, SigNoz)
  - Authentication, Deployment, Architecture, Contributing guides
  - All documentation now available at [logtide.dev/docs](https://logtide.dev/docs)

- **Documentation Components**: Removed docs-specific UI components
  - DocsSidebar, DocsTableOfContents, CodeBlock, Breadcrumbs components removed
  - These components are now part of the dedicated website project

## [0.3.3] - 2026-01-02

### Added

- **LDAP Authentication**: Enterprise directory integration for user authentication (#58)
  - LDAP/Active Directory server configuration via environment variables
  - Bind DN and search filter customization
  - Automatic user provisioning on first login
  - Secure LDAPS (SSL/TLS) support

- **OpenID Connect (OIDC)**: SSO integration with identity providers (#58)
  - Support for any OIDC-compliant provider (Authentik, Keycloak, Okta, Auth0, etc.)
  - Automatic discovery via `.well-known/openid-configuration`
  - Configurable scopes and claims mapping
  - Silent token refresh for seamless sessions

- **Initial Admin via Environment Variables**: Bootstrap admin account on first deployment (#58, #57)
  - Set `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_NAME` in `.env`
  - Auto-generates secure password if not provided (displayed in logs)
  - Only creates admin if no users with login credentials exist
  - Safe to leave configured - ignored after first user creation

- **Disable Sign-ups**: Control user registration for private deployments (#58)
  - Set `DISABLE_SIGNUPS=true` to prevent new user registration
  - Existing users and external auth (LDAP/OIDC) unaffected
  - Useful for invitation-only or enterprise deployments

- **Auth-free Mode for Home Labs**: Simplified single-user access (#58)
  - Set `AUTH_FREE_MODE=true` to bypass authentication entirely
  - Automatically uses first available organization
  - Perfect for home lab and development environments
  - Warning displayed in UI when enabled

- **ARM64 / Raspberry Pi Support**: Full support for ARM-based deployments (#58)
  - LogTide images built for both `linux/amd64` and `linux/arm64`
  - Native support for Raspberry Pi 3/4/5 (64-bit OS)
  - Configurable Fluent Bit image via `FLUENT_BIT_IMAGE` environment variable
  - Documentation for ARM64-specific Fluent Bit registry (`cr.fluentbit.io`)

### Changed

- **Fluent Bit**: Updated default version from `latest` to `4.2.2`
  - All documentation updated with pinned version
  - ARM64 alternative documented in all code examples

### Fixed

- **Mobile Navigation Menu**: Fixed hamburger menu button not working on mobile devices (#69)
  - Added `mobileMenuOpen` state to track menu visibility
  - Hamburger button now opens a sliding drawer with full navigation
  - Mobile menu includes all navigation items, organization switcher, and onboarding checklist
  - Smooth slide-in animation with backdrop overlay
  - Menu closes when clicking outside, pressing Escape, or navigating to a new page
  - Added mobile sidebar for documentation pages with "Menu" button

- **Services Dropdown in Log Search**: Fixed services combo box only showing services from current page (#66)
  - New `GET /api/v1/logs/services` endpoint returns all distinct services within the time range
  - Services dropdown now loads from API instead of deriving from current page logs
  - Services remain visible when applying filters (no more disappearing options)
  - Services list sorted alphabetically for easier navigation
  - Auto-refresh when changing time range or project selection
  - Loading indicator while fetching services
  - Selected services persist when changing time range (shows "no logs" indicator if empty)
  - Reset filters correctly when switching organization

- **Journald Log Format Detection**: Automatic parsing of systemd-journald logs (#60)
  - Auto-detects journald format (`_SYSTEMD_UNIT`, `SYSLOG_IDENTIFIER`, `MESSAGE`, `PRIORITY`, etc.)
  - Extracts service name from `SYSLOG_IDENTIFIER` → `_SYSTEMD_UNIT` → `_COMM` → `_EXE`
  - Extracts actual message from `MESSAGE` field instead of showing raw JSON
  - Maps `PRIORITY` (0-7) to LogTide levels (critical/error/warn/info/debug)
  - Uses journald timestamp (`__REALTIME_TIMESTAMP`) when present (already UTC)

- **Syslog Level Mapping**: Improved handling of syslog severity levels (#60)
  - Automatic mapping of syslog levels (notice, alert, emerg) to LogTide levels
  - Case-insensitive level normalization
  - Fixes logs appearing as "unknown" level

- **OTLP Protobuf Parsing**: Proper binary protobuf support for OpenTelemetry (#60)
  - Added `@opentelemetry/otlp-transformer` for correct protobuf decoding
  - Fixes "Request body size did not match Content-Length" errors
  - JSON and Protobuf formats both fully supported

---

## [0.3.2] - 2025-12-22

### Fixed

- **SvelteKit 2 Compatibility**: Updated imports from `$app/stores` to `$app/state` and adjusted event handlers (#55)
  - Migrated deprecated `$app/stores` imports to the new `$app/state` module
  - Updated event handlers to use the new SvelteKit 2 patterns
  - Ensures compatibility with latest SvelteKit versions

- **Traces Page Navigation**: Fixed "Get API Key" button on empty traces page leading to 404 (#53)
  - Corrected navigation path from `/projects` to `/dashboard/projects`
  - Fixed navigation buttons on the 404 error page
  - Fixed feature tour links missing `/dashboard` prefix (search, alerts, traces, projects)
  - Fixed trace detail page "Back to Traces" navigation

- **Registration Error**: Fixed "Failed to fetch" error during user registration (#54, fixes #52)
  - Resolved network error that prevented new users from completing registration
  - Improved error handling in the registration flow

---

## [0.3.1] - 2025-12-19

### Changed

- **Security Policy**: Updated supported versions in SECURITY.md

---

## [0.3.0] - 2025-12-10

### Added

- **SIEM Dashboard**: Full-featured Security Information and Event Management interface
  - Security Dashboard with 6 real-time widgets:
    - Summary stats (total detections, incidents, open, critical)
    - Top threats chart (Sigma rules ranked by detection count)
    - Detection timeline (time-series visualization)
    - Affected services list
    - Severity distribution pie chart
    - MITRE ATT&CK heatmap (techniques across tactics matrix)
  - Incident List page with filtering (status, severity) and pagination
  - Incident Detail page with three tabs:
    - Detections: matched log events with field details
    - Comments: collaboration thread for incident response
    - History: full activity timeline of status changes
  - Incident status workflow (Open → Investigating → Resolved → False Positive)
  - Assignee management for incident ownership
  - PDF export for incident reports (print-based generation)
  - Real-time updates via SSE (Server-Sent Events)

- **C# / .NET SDK**: Official SDK for .NET 6/7/8 applications
  - Full documentation at `/docs/sdks/csharp`
  - Automatic batching with configurable size and interval
  - Retry logic with exponential backoff
  - Circuit breaker pattern for fault tolerance
  - Query API for searching and filtering logs
  - Trace ID context for distributed tracing
  - ASP.NET Core middleware for auto-logging HTTP requests
  - Dependency injection support
  - Thread-safe, full async/await support

- **IP Reputation & GeoIP Enrichment** (Backend ready, UI in incident detail)
  - IP reputation lookup integration
  - GeoIP data display with map visualization
  - Enrichment cards in incident detail view

- **Organization Invitations**: Invite users to join your organization
  - Send email invitations to new team members
  - Pending invitations management (view, resend, revoke)
  - Role assignment on invite (admin, member)
  - Invitation acceptance flow with automatic org membership
  - Invitation expiration handling

- **Horizontal Scaling Documentation**: Guide for scaling LogTide across multiple instances
  - Traefik reverse proxy configuration with load balancing
  - Docker Compose overlay for scaled deployments
  - Sticky sessions for SSE connections
  - Health check configuration for backend instances
  - Environment variables for scaling configuration

### Changed

- **Homepage**: Added Go and C# to "Works with your stack" section
- **SDK Overview**: Added C# SDK card with installation and features
- **Sidebar Navigation**: Added C# / .NET link to SDKs section
- **README**:
  - Added SIEM Dashboard screenshot
  - Added SIEM feature to Alpha features list
  - New dedicated section for SIEM Dashboard & Incident Management
  - Added C# SDK to SDKs table
  - Updated Kotlin SDK link to GitHub repository

### Fixed

- PDF export now properly connected in incident detail page (was missing `onExportPdf` prop)

---

## [0.2.4] - 2025-12-04

### Added

- **Syslog Integration Documentation**: New guide for collecting logs from infrastructure
  - Fluent Bit configuration for syslog UDP/TCP on port 514
  - Parsers for RFC 3164 (traditional) and RFC 5424 (modern) syslog formats
  - Lua script for mapping syslog severity to log levels
  - Device-specific guides: Proxmox VE, VMware ESXi, UniFi, pfSense, Synology
  - Credit to Brandon Lee / VirtualizationHowto for inspiration

- **Go SDK Documentation**: Official SDK docs at `/docs/sdks/go`
  - Installation, quick start, configuration options
  - Logging methods, error handling, OpenTelemetry integration
  - HTTP middleware examples (standard library, Gin)

- **Documentation Restructure**
  - New "Integrations" section in docs sidebar (Syslog, OpenTelemetry)
  - Go SDK added to SDK overview and sidebar

### Changed

- **Docker Compose**: Improved container orchestration
  - Worker now depends on backend health (fixes migration race condition)
  - Redis healthcheck fixed with proper authentication
  - Updated all docker-compose files (production, dev, README, docs)

- **Onboarding Flow**: Fixed "Skip tutorial" behavior
  - Skip now goes to organization creation (required step)
  - After creating org, redirects to dashboard instead of continuing tutorial
  - Added `skipAfterOrgCreation` flag to onboarding store

- **Runtime Configuration**: Fixed PUBLIC_API_URL build-time vs runtime issue
  - Components now use `getApiUrl()` for runtime configuration
  - API URL can be changed via environment variables without rebuild
  - Affected: ApiKeyStep, FirstLogStep, EmptyLogs, EmptyTraces, EmptyDashboard

### Fixed

- "Sign Up Free" link on landing page pointing to non-existent `/signup` (now `/register`)
- Skip tutorial redirect loop to `/onboarding`
- API URL in code examples showing localhost instead of configured URL

## [0.2.3] - 2025-12-03

### Added

- **Docker Image Publishing**: Automated CI/CD for container distribution
  - GitHub Actions workflow (`publish-images.yml`) for building and pushing images
  - Multi-platform builds (linux/amd64, linux/arm64)
  - Automatic semantic versioning tags (e.g., 0.2.3, 0.2, 0, latest)
  - **Docker Hub**: `logtide/backend`, `logtide/frontend`
  - **GitHub Container Registry**: `ghcr.io/logtide-dev/logtide-backend`, `ghcr.io/logtide-dev/logtide-frontend`
  - Triggered on git tags (`v*.*.*`) or manual workflow dispatch

- **Self-Hosting Documentation**: Comprehensive deployment guides
  - Updated README with inline `docker-compose.yml` example
  - New deployment docs with pre-built images as recommended method
  - Environment variables reference table
  - Production tips (version pinning, SSL, backups)

### Changed

- **docker-compose.yml**: Now uses pre-built images from Docker Hub by default
  - Configurable via `LOGTIDE_BACKEND_IMAGE` and `LOGTIDE_FRONTEND_IMAGE` environment variables
  - No local build required for self-hosting

- **Documentation**: Updated all docs pages
  - `/docs` - Quick start with full docker-compose.yml inline
  - `/docs/getting-started` - Installation with pre-built images
  - `/docs/deployment` - Removed install.sh references, added image registry info

## [0.2.2] - 2025-12-02

### Added

- **Onboarding Tutorial**: Comprehensive guided setup for new users
  - Multi-step wizard with progress tracking:
    - Welcome step with personalized greeting
    - Organization creation with validation
    - Project creation with environment presets (Production, Staging, Development, Testing)
    - API key generation with code examples (cURL, Node.js, Python, PHP, Kotlin)
    - First log verification with real-time detection
    - Feature tour highlighting key capabilities
  - Skip and resume functionality (persisted to localStorage)
  - Mobile responsive design
  - Full keyboard accessibility (ARIA labels, focus management)
  - Backend API: `GET/POST /api/v1/onboarding/state`

- **Empty State Components**: Helpful guidance when no data exists
  - `EmptyLogs`: Guidance for log search with quick actions
  - `EmptyTraces`: Trace collection setup instructions
  - `EmptyDashboard`: Getting started checklist for new users

- **User Onboarding Checklist**: Persistent progress tracking
  - Sidebar widget showing setup completion status
  - Automatic detection of completed steps
  - Quick navigation to incomplete tasks
  - Dismissible after completion

- **UI Enhancements**
  - `HelpTooltip` component for contextual help
  - `FeatureBadge` component for feature highlighting
  - `Progress` component for visual progress bars
  - `UserSettingsDialog` with tutorial restart option

### Changed

- **Testing Infrastructure**: Significantly expanded test coverage
  - Backend: 897 tests (up from 563), **77.34% coverage** (up from 71%)
  - E2E: ~70 Playwright tests across 10 test files
  - New E2E journeys: onboarding flow, empty states, accessibility
  - Mobile responsive testing with viewport simulation

### Fixed

- Improved organization context handling in dashboard navigation
- Better error states and loading indicators throughout the app

## [0.2.1] - 2025-12-01

### Added

- **Redis Caching Layer**: Comprehensive caching to minimize database load
  - CacheManager utility with type-safe keys and configurable TTLs
  - Session validation caching (30 min TTL, invalidated on logout)
  - API key verification caching (60 sec TTL, async last_used updates)
  - Query result caching with deterministic keys (60 sec TTL)
  - Trace and aggregation caching (5 min TTL)
  - Automatic cache invalidation on log ingestion
  - Admin API endpoints for cache management:
    - `GET /api/v1/admin/cache/stats` - Cache hit/miss statistics
    - `POST /api/v1/admin/cache/clear` - Clear all cache
    - `POST /api/v1/admin/cache/invalidate/:projectId` - Invalidate project cache
  - Configuration via `CACHE_ENABLED` and `CACHE_TTL` environment variables

- **Landing Page**: New public index page for the application

### Changed

- **Database Optimization**: Comprehensive optimizations for sub-100ms query latency
  - New composite indexes for common query patterns:
    - `idx_logs_project_level_time` (project + level filtering)
    - `idx_logs_project_service_time` (project + service filtering)
    - `idx_logs_project_service_level_time` (combined filtering)
    - `idx_logs_project_errors` (partial index for error logs)
  - TimescaleDB Continuous Aggregates:
    - `logs_hourly_stats` for dashboard timeseries (10-50x faster)
    - `logs_daily_stats` for historical analytics
  - Compression policy changed from 7 days to 1 day (90% storage reduction)
  - PostgreSQL tuning (parallel queries, shared_buffers, work_mem, WAL)
  - Connection pooling with environment-based sizing (5/10/20 connections)
  - Statement timeout protection (30s prod, 60s dev)
  - Admin health endpoint with pool statistics

### Performance

- Session validation: ~30x faster (cache hit)
- API key verification: ~20x faster (cache hit)
- Query results: ~10x faster (cache hit)
- Aggregations: ~50x faster (cache hit)
- Verified: 722,890 logs ingested at 7.40ms P95, 0% errors

### Fixed

- **Admin Panel**: Fixed double sidebar and footer issue (layout inheritance reset)
- **Admin Routes**: Fixed incorrect navigation paths (missing `/dashboard` prefix)
  - User Management links now correctly navigate to user details
  - Organization Management links now correctly navigate to organization details
  - Projects Management links now correctly navigate to project details

## [0.2.0] - 2025-11-29

### Added

- **OpenTelemetry Support**: Full OTLP (OpenTelemetry Protocol) integration
  - `POST /v1/otlp/logs` endpoint for log ingestion (protobuf + JSON)
  - `POST /v1/otlp/traces` endpoint for trace ingestion
  - Automatic trace_id and span_id extraction
  - Resource attributes mapping to metadata
  - Severity number to log level conversion

- **Distributed Tracing**
  - Traces API with full CRUD operations
  - Span timeline visualization (Gantt chart)
  - Trace-to-logs correlation (click span to see related logs)
  - Service dependencies graph visualization
  - Keyboard accessibility for span selection

- **Testing Infrastructure**
  - 563+ backend tests with 71% coverage
  - 60 E2E tests with Playwright
  - Test factories for spans and traces
  - Load testing scripts with k6

### Changed

- Optimized OTLP ingestion performance for high-throughput scenarios
- Enhanced span selection UX with keyboard navigation
- Optimized service dependencies query performance

### Fixed

- Frontend UX issues during OTLP data display
- Trace_id handling now accepts any string format

## [0.1.0] - 2025-11-01

### Added

- Initial public alpha release
- Multi-organization architecture with data isolation
- High-performance batch log ingestion API
- Real-time log streaming via Server-Sent Events (SSE)
- Advanced search and filtering (service, level, time, full-text, trace_id)
- TimescaleDB compression and automatic retention policies
- Dashboard with organization-wide statistics
- Alert system with threshold-based rules
- Email and webhook notifications
- Sigma detection engine for security rules
- Official SDKs: Node.js, Python, PHP, Kotlin
- Docker Compose deployment support
