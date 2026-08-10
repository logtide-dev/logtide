# Outbound Webhooks

LogTide delivers events (alerts, anomalies, errors, monitor status changes, security incidents, and notification-channel webhooks) to your endpoints through a centralized dispatcher with SSRF protection, retry with exponential backoff, a dead-letter queue, and delivery logging.

## Delivery semantics

- **Retries:** transient failures (network errors, timeouts, HTTP 5xx, 429) are retried with exponential backoff (1s, 5s, 25s, 2m, 10m), up to a configurable maximum (`WEBHOOK_MAX_ATTEMPTS`, default 5). Non-transient failures (other 4xx) are not retried.
- **Dead-letter queue:** after the final failed attempt a delivery is marked `dead`. Dead and failed deliveries can be replayed from the dashboard (Settings → Webhook Deliveries).
- **Idempotency:** each delivery carries a stable id. The same logical event is not enqueued twice, so a receiver can safely deduplicate on the event id.
- **Timeout:** each attempt times out after `WEBHOOK_REQUEST_TIMEOUT_MS` (default 10s).

## Verifying webhook signatures

When a signing secret is configured for a webhook, LogTide signs each delivery so you can verify it came from LogTide and was not tampered with:

- `X-Logtide-Timestamp: <unix seconds>`
- `X-Logtide-Signature: t=<unix>,v1=<hex hmac>`

The signature is `HMAC-SHA256(secret, "<timestamp>.<raw request body>")`, hex-encoded.

```js
import crypto from 'crypto';

function verify(secret, headers, rawBody) {
  const ts = headers['x-logtide-timestamp'];
  const sig = headers['x-logtide-signature'].split('v1=')[1];
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Verify against the **raw** request body (before JSON parsing), since any reserialization can change the bytes and break the signature. Reject deliveries whose timestamp is older than your tolerance (e.g. 5 minutes) to prevent replay.

## Event envelope

Every delivery body is a JSON object with a top-level envelope. The `data` field carries the event-specific payload.

```json
{
  "id": "evt_4b3e1a2c-8f7d-4e6b-9c0a-1d2e3f4a5b6c",
  "type": "alert.triggered",
  "version": 1,
  "occurredAt": "2026-06-11T14:32:07.841Z",
  "organizationId": "9f8e7d6c-5b4a-3c2d-1e0f-a1b2c3d4e5f6",
  "projectId": "3a4b5c6d-7e8f-9a0b-1c2d-3e4f5a6b7c8d",
  "data": {
    "alert_name": "Error rate spike",
    "log_count": 142,
    "threshold": 50,
    "time_window": 300,
    "baseline_metadata": null,
    "link": "https://app.logtide.dev/alerts/history/abc123"
  }
}
```

### Envelope fields

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Stable delivery id with prefix `evt_` followed by a UUID. Doubles as the dedup `eventId` when the producer does not supply one. |
| `type` | `string` | Event type (see table below). |
| `version` | `number` | Schema version. Currently always `1`. The `X-Logtide-Event-Version: 1` header carries the same value for quick routing without parsing the body. |
| `occurredAt` | `string` | ISO 8601 timestamp of when the event occurred. |
| `organizationId` | `string (UUID)` | Organization that owns the event. |
| `projectId` | `string (UUID) \| null` | Project scope. `null` for org-wide events (e.g. some alert rules without a project filter). |
| `data` | `object` | Event-specific payload. See per-type fields below. |

### Event types

| Type | Description |
| --- | --- |
| `alert.triggered` | An alert rule or anomaly detection fired. Anomaly detections carry a non-null `data.baseline_metadata` object. |
| `incident.created` | A new security incident was created (typically from a Sigma rule detection). |
| `error.detected` | An exception group crossed its notification threshold. |
| `monitor.status_changed` | An uptime monitor changed status (e.g. up → down). |
| `channel.test` | A test delivery sent when verifying a notification channel. |

### Per-type `data` fields

**`alert.triggered`**

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `alert_name` | yes | `string` | Name of the alert rule. |
| `log_count` | yes | `number` | Number of matching log events in the evaluation window. |
| `threshold` | yes | `number` | Configured threshold value. |
| `time_window` | yes | `number` | Evaluation window in seconds. |
| `baseline_metadata` | yes | `object \| null` | Non-null for anomaly/rate-of-change detections. Contains `baseline_value`, `current_value`, `deviation_ratio`, `baseline_type`, and `evaluation_time`. |
| `link` | yes | `string` | URL to the alert history entry in the LogTide dashboard. |

**`incident.created`**

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `title` | yes | `string` | Incident title. |
| `message` | yes | `string` | Human-readable summary. |
| `severity` | yes | `string` | `critical`, `high`, `medium`, `low`, or `informational`. |
| `organization` | yes | `{ id, name }` | Organization reference. |
| `incident_id` | yes | `string` | Incident UUID. |
| `affected_services` | no | `string[]` | Services involved, if known. |
| `link` | yes | `string` | URL to the incident detail page. |

**`error.detected`**

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `title` | yes | `string` | Short error title. |
| `message` | yes | `string` | Exception message or summary. |
| `severity` | yes | `string` | Severity level. |
| `organization` | yes | `{ id, name }` | Organization reference. |
| `project` | yes | `{ id, name }` | Project reference; `id` may be `null` if the error has no project scope. |
| `error_group_id` | yes | `string` | Stable id for the error group (dedup key). |
| `exception_type` | no | `string \| null` | Exception class name (e.g. `TypeError`). |
| `language` | no | `string \| null` | Runtime language reported by the SDK. |
| `service` | no | `string \| null` | Service name. |
| `is_new` | yes | `boolean` | `true` the first time this error group fires. |
| `link` | yes | `string` | URL to the error detail page. |

**`monitor.status_changed`**

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `monitor_id` | yes | `string` | Monitor UUID. |
| `monitor_name` | yes | `string` | Human-readable monitor name. |
| `status` | yes | `string` | New status (e.g. `down`, `up`, `degraded`). |
| `severity` | yes | `string` | Severity of the status change. |
| `title` | yes | `string` | Short notification title. |
| `message` | yes | `string` | Full notification body. |
| `organization` | yes | `{ id, name }` | Organization reference. |
| `target` | no | `string` | Monitored URL or host. |
| `error_code` | no | `string \| null` | HTTP status code or error code from the check. |
| `response_time_ms` | no | `number \| null` | Last response time in milliseconds. |
| `consecutive_failures` | no | `number` | How many checks in a row have failed. |
| `downtime_duration` | no | `string \| null` | Human-readable duration of the current downtime. |
| `link` | yes | `string` | URL to the monitor detail page. |

**`channel.test`**

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `title` | yes | `string` | Test notification title. |
| `message` | yes | `string` | Test notification body. |
| `severity` | no | `string` | Optional severity label. |
| `organization` | no | `{ id, name }` | Organization reference, if available. |
| `link` | no | `string` | Optional dashboard link. |
| `metadata` | no | `Record<string, unknown>` | Arbitrary key/value pairs. |

### Historical replays

Deliveries created before the envelope change that are manually replayed re-send their stored pre-envelope payload while still carrying the `X-Logtide-Event-Version` header; receivers should treat the header as advisory for replayed historical deliveries.

### Signature covers the envelope

The HMAC signature (see "Verifying webhook signatures" below) covers the serialized envelope as the raw request body. The existing verification snippet is valid for envelope payloads without any changes. The `X-Logtide-Event-Version: 1` header lets you route by version before parsing.

For destinations with a vendor-specific body (see "Discord destinations" below), the signature covers the bytes actually sent, which are the vendor payload rather than the envelope.

### Zod schemas from `@logtide/shared`

```ts
import { webhookEnvelopeSchema, parseWebhookEvent } from '@logtide/shared';

// Parse envelope only (data field is Record<string, unknown>)
const envelope = webhookEnvelopeSchema.parse(body);

// Parse envelope AND validate the per-type data schema
const envelope = parseWebhookEvent(body);
```

`parseWebhookEvent` throws a Zod `ZodError` if either the envelope shape or the per-type `data` fields are invalid.

---

## Discord destinations

A webhook whose URL is a Discord webhook endpoint receives a Discord message instead of the envelope, because Discord rejects any body without `content`, `embeds` or file parts with HTTP 400.

Detection: host `discord.com` or `discordapp.com` (including subdomains such as `ptb.` and `canary.`) with a path starting `/api/webhooks/` or `/api/v10/webhooks/`. This applies to every event source (channel test, monitors, alerts, incidents, errors) as well as retries and replays; no channel setting is involved.

Each event becomes one embed: `title` and `description` come from the event data, the color from its severity (green for a monitor recovery), the footer from the organization name, `timestamp` from the envelope `occurredAt`, `url` from the event link, and the remaining per-type values become embed fields. Discord's size limits are enforced by truncating values and dropping trailing fields.

To receive something else, append `/slack` or `/github` to the Discord webhook URL: those are Discord's own compatibility endpoints, and LogTide leaves the body of such URLs alone.

The delivery log keeps storing the canonical envelope, so replays and the delivery detail view show the event rather than the Discord payload.

---

## SSRF protection

Outbound targets are resolved and validated before each request; loopback, private, link-local (including cloud metadata), CGNAT, multicast, and reserved IPv4/IPv6 ranges are rejected, and every redirect hop is revalidated. Self-hosted deployments that need to reach internal endpoints can opt in with `MONITOR_ALLOW_PRIVATE_TARGETS=true`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `WEBHOOK_MAX_ATTEMPTS` | `5` | Maximum delivery attempts before the dead-letter queue. |
| `WEBHOOK_PER_ORG_CONCURRENCY` | `5` | Concurrent deliveries per organization. |
| `WEBHOOK_GLOBAL_CONCURRENCY` | `50` | Concurrent deliveries across all organizations. |
| `WEBHOOK_DELIVERY_LOG_LIMIT` | `1000` | Attempts retained per delivery in the delivery log. |
| `WEBHOOK_REQUEST_TIMEOUT_MS` | `10000` | Per-attempt request timeout in milliseconds. |
| `WEBHOOK_DEDUP_WINDOW_MS` | `60000` | How long an in-flight delivery suppresses an identical re-enqueue of the same event. |
| `MONITOR_ALLOW_PRIVATE_TARGETS` | `false` | Allow delivery to private/internal addresses (self-hosted). |
