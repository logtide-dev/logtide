# Webhook Receivers

Webhook receivers let external systems (CI/CD pipelines, uptime monitors, arbitrary tools) push events into LogTide. Each receiver exposes a unique tokenized URL; incoming payloads are normalized into standard log entries by an adapter and stored through the regular ingestion pipeline, so PII masking, usage quotas, Sigma detection and parsing rules all apply automatically.

Receivers are project-scoped and managed from **Project Settings > Webhook Receivers**, where you can create receivers, copy their URL, enable or disable them, and inspect the most recent received events with their normalized output.

## Endpoint contract

```
POST /api/v1/receivers/{receiverId}/{token}
Content-Type: application/json
```

The URL itself is the credential: `receiverId` identifies the receiver and `token` authenticates the request. No headers are required, which makes the endpoint compatible with systems that cannot send custom headers (GitHub webhooks, Uptime Robot).

The body must be a single JSON object of at most 256 KB.

### Responses

| Status | Meaning |
| --- | --- |
| `202 Accepted` | Event stored and queued for processing. Body: `{ "eventId": "..." }` |
| `400 Bad Request` | Body is not a JSON object (arrays, scalars and null are rejected) |
| `401 Unauthorized` | Token does not match the receiver |
| `403 Forbidden` | Receiver is disabled |
| `404 Not Found` | Unknown receiver id |
| `413 Payload Too Large` | Serialized payload exceeds 256 KB |

Processing is asynchronous: a `202` means the payload was accepted, not that it produced a log entry. The outcome (`processed`, `skipped` or `failed`, with the normalized output and any error) is visible in the receiver's recent-events view, which keeps the last 100 events per receiver.

## Tokens

Receiver tokens use the `lr_` prefix (distinct from `lp_` project API keys) and are shown exactly once, at creation time, embedded in the full webhook URL. Only a SHA-256 hash is stored. Treat the URL as a secret: anyone who has it can write logs into your project. To rotate a token, delete the receiver and create a new one, then update the external system with the new URL.

A receiver token cannot read data or call any other API endpoint; a leaked URL limits the blast radius to log ingestion into one project.

## Adapters

The adapter chosen at creation time decides how raw payloads become log entries.

### GitHub

Point a GitHub repository webhook (JSON content type) at the receiver URL. Supported events:

- **workflow_run** (only `action: completed`): `success` maps to `info`, `cancelled`/`skipped`/`neutral` to `warn`, `failure`/`timed_out`/`startup_failure`/`action_required` to `error`. The message looks like `Workflow CI completed: failure`.
- **deployment_status**: `success` maps to `info`, `failure`/`error` to `error`, anything else to `info`. The message looks like `Deployment to production: failure`.

The `service` field is the repository `full_name` (e.g. `acme/app`). Metadata includes the event type, workflow name, conclusion, run id and URL, branch and actor. Ping events and unsupported event types are marked `skipped`, not failed.

Example: a failed CI run

```json
{
  "action": "completed",
  "workflow_run": { "name": "CI", "conclusion": "failure", "html_url": "...", "head_branch": "main" },
  "repository": { "full_name": "acme/app" },
  "sender": { "login": "octocat" }
}
```

becomes an `error` log for service `acme/app` with message `Workflow CI completed: failure`.

### Uptime

Detects two payload shapes automatically:

- **Uptime Robot** (`alertType` field): `1` (down) maps to `error`, `2` (up) to `info`, `3` (SSL expiry) to `warn`. The monitor friendly name becomes the service.
- **Better Stack** (`data.attributes` incident shape): status `Started` maps to `error`, `Resolved` and `Acknowledged` to `info`. The monitor name becomes the service and the incident cause is part of the message.

Unrecognized shapes are marked `skipped`.

### Generic JSON

Accepts any JSON object. Without configuration it produces one `info` log with message `Received event`, the receiver name as service, and the full payload preserved under `metadata.payload`.

An optional **field mapping** extracts log fields from the payload using dot-paths:

```json
{
  "message": "error.message",
  "level": "severity",
  "service": "source.app",
  "timestamp": "ts",
  "levelMap": { "crit": "critical", "sev1": "error" },
  "defaults": { "level": "warn", "service": "external-system" }
}
```

| Key | Meaning |
| --- | --- |
| `message` | Dot-path to the log message. Missing or non-string values fall back to `Received event`. |
| `level` | Dot-path to the level value. Values are lowercased and matched against LogTide levels (`debug`, `info`, `warn`, `error`, `critical`); the synonyms `warning`, `fatal`, `err` and `crit` are also understood. |
| `service` | Dot-path to the service name (truncated to 100 chars). Falls back to `defaults.service`, then the receiver name. |
| `timestamp` | Dot-path to an ISO string or epoch value. Unparseable values fall back to the arrival time. |
| `levelMap` | Case-insensitive map applied to the extracted level value before the builtin matching (e.g. map `sev1` to `error`). |
| `defaults` | Fallback `level` and `service` used when the mapped values are missing or invalid. |

The create dialog exposes the four path fields; `levelMap` and `defaults` can be set through the API (`PATCH /api/v1/projects/{projectId}/receivers/{id}` with a `fieldMapping` object).

## Pipeline guarantees

Received events are ingested through the same path as `POST /api/v1/ingest`:

- **PII masking is fail-closed**: entries whose masking fails are rejected, and the event is marked `failed` with the rejection reason.
- **Usage quotas** (`ingestion.max_bytes_monthly`, `ingestion.max_events_monthly`, `storage.max_bytes`) apply; over-quota events fail with the quota error recorded.
- Sigma detection, exception parsing, log pipelines, metering and live tail all see receiver events like any other ingested log.

The number of receivers per organization can be capped with the `receivers.max` capability (unlimited by default in OSS).

## Management API

All management endpoints require session authentication and project access.

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/projects/{projectId}/receivers` | List receivers (never returns tokens) |
| `POST /api/v1/projects/{projectId}/receivers` | Create; returns `token` and `ingestPath` once |
| `PATCH /api/v1/projects/{projectId}/receivers/{id}` | Rename, enable/disable, update `fieldMapping` |
| `DELETE /api/v1/projects/{projectId}/receivers/{id}` | Delete (invalidates the URL immediately) |
| `GET /api/v1/projects/{projectId}/receivers/{id}/events?limit=50` | Recent events with raw payload, normalized output and status |

Receiver creation and deletion are recorded in the audit log (`receiver.created`, `receiver.deleted`).
