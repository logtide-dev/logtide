# Hosting LogTide for others

LogTide is self-hosted by default: with none of the variables below set, nothing changes. Every limit is unlimited, nobody has to verify an email, no upgrade buttons are shown, no service token is accepted and none of the optional routes exist.

This page is for operators who run LogTide on behalf of other people (a managed or multi-customer deployment) and need to cap usage, gate sign-ups and connect an external billing portal. Everything is driven by environment variables; an invalid value aborts startup with a clear message instead of being ignored.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CAPABILITY_DEFAULTS_JSON` | unset | Override the default value of any capability for all organizations |
| `LOGTIDE_ADMIN_SERVICE_TOKEN` | unset | Static bearer for a billing service on the entitlements and retention admin routes |
| `LOGTIDE_UPGRADE_URL` | unset | External billing portal the Upgrade / Manage billing buttons redirect to |
| `LOGTIDE_UPGRADE_SIGNING_SECRET` | unset | HMAC secret used to sign the handoff token |
| `MAX_ORGANIZATIONS_PER_USER` | unset (unlimited) | Maximum organizations one user may own |
| `MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH` | unset (unlimited) | Maximum organizations one user may create per UTC calendar month |
| `REQUIRE_EMAIL_VERIFICATION` | `false` | Require new local users to confirm their email |
| `REGISTRATION_RATE_LIMIT_PER_HOUR` | unset (off) | Extra per-IP cap on registrations over one hour |
| `LOGTIDE_TERMS_URL` | unset | Terms of Service page users must accept |
| `LOGTIDE_PRIVACY_URL` | unset | Privacy Policy page users must accept |
| `LOGTIDE_TERMS_VERSION` | unset | Current terms version; changing it asks every user to accept again |

An empty string is treated the same as unset for all of them. The bundled `docker/docker-compose*.yml` files pass all eleven through to both the `backend` and the `worker` containers (as empty strings when unset), so setting them in your `.env` is enough.

### CAPABILITY_DEFAULTS_JSON

A JSON object mapping capability names to values:

```
CAPABILITY_DEFAULTS_JSON={"projects.max": 3, "ingestion.max_bytes_monthly": 1073741824, "quota.grace_percent": 10}
```

- Boolean capabilities take `true` or `false`.
- Limit and quota capabilities take an integer `>= 0`, or `null` for unlimited.
- Unknown capability names, wrong types or malformed JSON abort startup. The whole document is validated before anything is applied.
- Resolution order is unchanged: a per-organization entitlement row always wins over the default. The defaults apply to every organization that has no row for that capability.
- Quota evaluation: if any quota default is finite, the quota evaluator checks every organization (not only organizations that have entitlement rows), so a default quota actually blocks ingestion.

### LOGTIDE_ADMIN_SERVICE_TOKEN

A static secret (at least 32 characters; shorter aborts startup) that lets an external service call a small set of admin endpoints without a user session:

- `GET /api/v1/admin/organizations/:id/entitlements`
- `PUT /api/v1/admin/organizations/:id/entitlements`
- `GET /api/v1/admin/organizations/:id/retention`
- `PUT /api/v1/admin/organizations/:id/retention`

Send it as `Authorization: Bearer <token>`. Details:

- The token is compared in constant time and is honored only on the four routes above. On every other route it is treated like any invalid session token. Other admin routes, such as `POST /api/v1/admin/retention/execute`, still require a real admin user.
- Writes through the token are audited with `actor: service:admin-service` in the entry metadata.
- Unset means the feature is inert.

Entitlement body for `PUT`:

```json
{ "entitlements": [ { "capability": "projects.max", "limitValue": 5 } ] }
```

`limitValue` is an integer `>= 0` or `null`; boolean capabilities use `enabled`. Unknown capabilities are rejected with `400`. Limits are stored as `BIGINT`, so byte quotas of 2 GiB and more work; the API accepts values up to `Number.MAX_SAFE_INTEGER` (2^53 - 1, about 8 PiB) so they always read back exactly.

### Upgrade handoff (LOGTIDE_UPGRADE_URL and LOGTIDE_UPGRADE_SIGNING_SECRET)

These two enable a signed redirect to an external billing portal. They must be set together:

- Only one set aborts startup.
- `LOGTIDE_UPGRADE_URL` must be an absolute `https` URL (`http` is accepted only for `localhost` and `127.0.0.1`).
- `LOGTIDE_UPGRADE_SIGNING_SECRET` must be at least 32 characters.

When active:

- `POST /api/v1/organizations/:id/upgrade-handoff` exists (it is not registered at all otherwise). Body: `{ "intent": "upgrade" | "manage" }`. Only owners and admins of the organization may call it (`403` otherwise). It returns `{ "url": "..." }`, which is `LOGTIDE_UPGRADE_URL` with the token in the `t` query parameter (an existing query string is preserved).
- `GET /api/v1/auth/config` includes `upgradeEnabled: true`, and the Usage page shows Upgrade / Manage billing buttons to owners and admins.
- Capability (`403`) and quota (`429`) denials include `upgrade_available: true` in the body. This covers the OTLP endpoints too: the `429` bodies of `POST /v1/otlp/logs`, `/v1/otlp/traces` and `/v1/otlp/metrics` carry `upgrade_available: true` next to `partialSuccess`.

The token never carries any LogTide session credential. It proves who the user is, their role and the organization.

#### Token format

```
token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, base64url(JSON payload)))
```

The HMAC is computed over the base64url string of the payload (the part before the dot), using the signing secret as the key. base64url has no padding.

Payload fields:

| Field | Type | Meaning |
|---|---|---|
| `v` | `1` | Token version |
| `org` | string | Organization id (UUID) |
| `user` | string | User id (UUID) |
| `email` | string | User email |
| `role` | string | The user's role in the organization (`owner` or `admin`) |
| `intent` | `"upgrade"` or `"manage"` | Which button was clicked |
| `exp` | number | Expiry, unix seconds. Tokens live 10 minutes |
| `nonce` | string | Random value, unique per token |

A verifier must: split on the single `.`, recompute the HMAC and compare in constant time, parse the payload, check `v === 1`, check all fields, and reject if `exp` is not in the future. The portal should also remember used `nonce` values until `exp` if it wants single-use semantics. The token is passed in a URL, so treat it as short-lived and do not log it.

A complete reference verifier using only Node's `crypto` is in [`docs/examples/verify-handoff.ts`](examples/verify-handoff.ts). Type-check it with `npx tsc -p docs/examples/tsconfig.json`.

### MAX_ORGANIZATIONS_PER_USER

Positive integer; unset = unlimited; anything else aborts startup. It counts organizations where the user is `owner`; being a member or admin of someone else's organization never counts. At the cap, `POST /api/v1/organizations` answers `403 { "error": "organization_limit_reached", "message": ... }`. That endpoint is the only path that creates a user-owned organization (registration, invitations and SSO login do not). Operator scripts such as seeding are not capped.

### MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH

Positive integer; unset = unlimited; anything else aborts startup. Monthly quotas are per organization and `MAX_ORGANIZATIONS_PER_USER` only counts organizations the user owns right now, so without this cap a user at the limit could delete an organization (a hard delete) and create a fresh one with zero month-to-date usage, resetting the free quota as often as they like. This cap counts creations instead of ownership: every `POST /api/v1/organizations` appends a row to `organization_creation_log` (always, even when the variable is unset, so turning the cap on later already has history), and the row survives the organization being deleted. When the number of rows for the user since the start of the current UTC calendar month (the same boundary the monthly quotas use) reaches the limit, the endpoint answers `403 { "error": "organization_creation_limit_reached", "message": ... }`. `MAX_ORGANIZATIONS_PER_USER` is checked first. The count and the insert run under a per-user lock, so parallel requests cannot overshoot either cap. There is no backfill: only creations made after migration 060 count.

### REQUIRE_EMAIL_VERIFICATION

`true` or `false` (default `false`); any other value aborts startup. **`true` requires `SMTP_HOST`**, otherwise startup fails, because no verification email could be sent.

When `true`:

- Newly registered local users are still signed in immediately and receive an email with a link to `/verify-email?token=...`. The token is 32 random bytes, stored only as a SHA-256 hash, single use, valid 24 hours.
- Until verified, `POST /api/v1/projects`, `POST /api/v1/projects/:id/api-keys` and `POST /api/v1/projects/:id/receivers` (an inbound receiver mints an ingest credential too) answer `403 { "error": "email_not_verified" }`. This check runs before the `projects.max` limit check.
- New routes: `POST /api/v1/auth/verify-email` (`400 invalid_or_expired_token` for unknown, reused, expired or someone else's token) and `POST /api/v1/auth/resend-verification` (always `202`, so it does not reveal whether an address exists; limited to 5 per hour per IP and a 60 second per-user cooldown).
- `GET /api/v1/auth/config` includes `emailVerificationRequired: true`; `GET /api/v1/auth/me` includes `user.emailVerified`. The app shows a "Verify your email" banner.
- OIDC users count as verified when the identity provider asserts `email_verified: true` for the current address. Admin-created, LDAP and bootstrap users are verified. Changing the email address requires verifying again.
- Existing users are backfilled as verified, so enabling the flag never locks anyone out.

When `false`, the verification routes are not registered and every user counts as verified.

### REGISTRATION_RATE_LIMIT_PER_HOUR

Positive integer; unset = off; anything else aborts startup. Caps `POST /api/v1/auth/register` per client IP over a one-hour window, on top of `AUTH_RATE_LIMIT_REGISTER`. It is keyed by IP only, so a forged `Authorization` header cannot rotate the counter. Over the cap the route answers `429` with a `Retry-After` header. It needs the rate-limit plugin; if that is not registered a warning is logged and the cap is not applied. Behind a reverse proxy set `TRUST_PROXY=true` so client IPs are resolved correctly, otherwise every request shares one IP (see Operator notes).

### Terms acceptance (LOGTIDE_TERMS_URL, LOGTIDE_PRIVACY_URL and LOGTIDE_TERMS_VERSION)

Active only when all three are set. Setting one or two aborts startup with a message naming the missing ones; so does a URL that is not an absolute https URL (plain http is allowed only for `localhost` and `127.0.0.1`) or a version that is empty, only spaces or longer than 64 characters. A date such as `2026-10-19` works well as the version. Unset or empty: the feature is fully inert (no checkbox, no modal, no new route, no extra keys, columns stay NULL).

When active:

- `GET /api/v1/auth/config` includes `termsUrl`, `privacyUrl` and `termsVersion`. The registration form then shows a required "I agree to the Terms of Service and the Privacy Policy" checkbox (both links open in a new tab) and the submit button stays disabled until it is checked.
- `POST /api/v1/auth/register` must carry `acceptTerms: true`, otherwise it answers `400 { "error": "terms_not_accepted" }` and no user is created. The accepted version and time are stored with the new user (`users.terms_version`, `users.terms_accepted_at`, migration 061).
- A user whose stored version differs from `LOGTIDE_TERMS_VERSION` (NULL included) is "terms pending". This covers users created before the feature was turned on (there is no backfill), OIDC/LDAP users who never saw the checkbox, and everyone after a version bump. `GET /api/v1/auth/me` then includes `user.termsAcceptanceRequired: true` and the app shows a blocking modal on the dashboard and onboarding pages with both links, an Accept button and a Log out option.
- `POST /api/v1/auth/accept-terms` (session required, rate limited like login) with body `{ "version": "<current version>" }` records the acceptance. Any other version answers `409 { "error": "terms_version_mismatch" }`, so a tab left open across a version bump cannot accept terms the user did not see. Each acceptance is audited as `user.terms_accepted`.
- While pending, `POST /api/v1/organizations`, `POST /api/v1/projects`, `POST /api/v1/projects/:id/api-keys` and `POST /api/v1/projects/:id/receivers` answer `403 { "error": "terms_not_accepted" }` (checked before the organization caps and the `projects.max` limit). Everything else keeps working: **ingestion with existing API keys is never blocked**, so bumping the version never breaks a running pipeline.

To publish new terms, update the pages and change `LOGTIDE_TERMS_VERSION`, then restart the backend: every user is asked again on their next visit. A page left open shows the modal as soon as one of its requests is refused with `terms_not_accepted`, without a reload.

**Not compatible with auth-free mode.** In auth-free mode the default user has no session and could never accept, so the backend refuses to start when the terms are configured and the stored auth mode is `none`, and the admin settings API refuses to switch `auth.mode` to `none` while they are configured (`400 { "error": "terms_incompatible_with_auth_free_mode" }`).

## Capabilities added for hosting

All of them default to unlimited and can be set per organization through entitlements, through the admin API, or globally through `CAPABILITY_DEFAULTS_JSON`.

| Capability | Kind | Meaning |
|---|---|---|
| `projects.max` | limit | Maximum number of active projects (soft-deleted ones do not count). Enforced on `POST /api/v1/projects` and on restoring a soft-deleted project (`POST /api/v1/projects/:id/restore`); both answer `403` at the limit |
| `quota.grace_percent` | limit | Overage allowed above every quota of the organization before hard-blocking. `null` or `0` means no grace |
| `metrics.max_datapoints_monthly` | quota | Month-to-date ingested OTLP metric datapoints. Over the limit `POST /v1/otlp/metrics` answers `429` while logs and spans keep flowing |
| `telemetry.max_bytes_monthly` | quota | Month-to-date ingested bytes across logs, traces and metrics combined. Over the limit log ingestion (`POST /api/v1/ingest` and every other log path, including `POST /v1/otlp/logs`), `POST /v1/otlp/traces` and `POST /v1/otlp/metrics` all answer `429` |

Metric datapoints are now metered as the `metrics.ingested.datapoints` usage type (only datapoints that were actually stored). Like spans, this follows `METERING_ENABLED`.

### Combined telemetry quota (recommended for hosted plans)

`telemetry.max_bytes_monthly` is the recommended single quota for a hosted plan ("N GB per month of logs, traces and metrics"). Its usage is the sum of three metering types, all measured the same way, as `Buffer.byteLength(JSON.stringify(records))` of the accepted records, counting customer-provided data only:

| Signal | Metering type | Records measured |
|---|---|---|
| Logs | `logs.ingested.bytes` | The log batch of the request, after PII-masking rejections (unchanged, also used by `ingestion.max_bytes_monthly`) |
| Traces | `spans.ingested.bytes` | The spans handed to storage, after PII masking dropped the spans it could not mask, without the server-injected `organizationId`, `projectId` and `time` (a copy of `startTime`) fields |
| Metrics | `metrics.ingested.bytes` | The datapoints handed to storage, without the server-injected `organizationId` and `projectId` fields |

The excluded fields are left out of a measured copy only; what is stored is unchanged. Nothing is counted when storage accepted no record; if a store reports only part of a batch as stored, the batch size is prorated by the accepted count. Measurement happens before storage and does not depend on the storage engine (TimescaleDB, ClickHouse and MongoDB measure identically). These are billed types (no `ingestion.` prefix): they show in usage data and follow `METERING_ENABLED`.

The per-signal quotas keep working and can be combined with it; an organization is blocked by whichever applies first. A typical hosted setup sets `telemetry.max_bytes_monthly` per plan and keeps `metrics.max_datapoints_monthly` as a high safety cap against cardinality abuse. When `telemetry.max_bytes_monthly` has a limit, the Usage page hides the quotas left unlimited, so only the plan's meters show; otherwise (including a self-hosted instance that caps some other quota) every row shows as before. The "Log bytes ingested" summary card on that page counts log bytes only.

## Quota behavior

Quotas (`ingestion.max_bytes_monthly`, spans, metric datapoints and so on) are consumption caps that reset on the first day of each calendar month, UTC.

- A background evaluator (`QUOTA_EVALUATOR_INTERVAL_MS`, default 60 seconds, disable with `QUOTA_EVALUATOR_ENABLED=false`) recomputes usage and decides the state, so blocking can lag by up to one interval.
- A quota is `ok` below its limit, in `grace` from the limit up to `limit * (1 + grace_percent / 100)`, and `blocked` from that ceiling on. With no grace the first state past the limit is `blocked`. Ingestion is rejected only when `blocked`; blocked requests answer `429`.
- The first time a quota enters `grace` or becomes `blocked` within a UTC month, organization owners and admins get an in-app notification and an email (the email needs SMTP; a failed email never breaks the evaluator). Each organization, capability, state and limit value is notified at most once per month: raising the limit mid-month (an upgrade) re-arms the notice at the new ceiling. With several backend replicas the check is atomic (a Postgres advisory lock), so one notice and one email go out, not one per replica.
- The Usage page shows "In grace" and "Blocked" badges. The capability usage API returns a `state` for quota rows.

## The internal logging organization

Unless `INTERNAL_LOGGING_ENABLED=false` (or an `INTERNAL_API_KEY` is supplied), LogTide creates a `logtide-internal` organization (with a project and an API key) for its own self-monitoring logs. It is an ordinary organization: every finite default from `CAPABILITY_DEFAULTS_JSON` applies to it, so a small default quota can block LogTide's own logs and a `projects.max` default counts its project. Give it explicit unlimited (`null`) entitlement rows for every capability your defaults restrict, for example with `PUT /api/v1/admin/organizations/<internal org id>/entitlements`:

```json
{ "entitlements": [
  { "capability": "ingestion.max_bytes_monthly", "limitValue": null },
  { "capability": "ingestion.max_events_monthly", "limitValue": null },
  { "capability": "storage.max_bytes", "limitValue": null }
] }
```

## Operator notes

- **Reverse proxy**: `REGISTRATION_RATE_LIMIT_PER_HOUR` (like every IP-keyed limit) needs `TRUST_PROXY=true` when LogTide runs behind a proxy or load balancer. Without it every request appears to come from the proxy and all visitors share one counter.
- **Service token rate limit**: the four service-token routes keep the admin rate limit of 100 requests per minute. The limiter key is derived from the credential (a hash, never the raw value), so every call made with the service token shares one counter; send several entitlement changes in one `PUT` instead of one request per capability.
- **Metering**: quotas are evaluated against metered usage. With `METERING_ENABLED=false` nothing is metered, so quotas see no usage and never block. Static limits such as `projects.max` still apply.
- **Capability names are part of the contract**: `CAPABILITY_DEFAULTS_JSON` rejects unknown names at startup. If a future release renames a capability, a JSON value that still uses the old name aborts startup; check the release notes before upgrading.
- **Evaluation lag**: quota state is recomputed every `QUOTA_EVALUATOR_INTERVAL_MS` (default 60 seconds), so ingestion can run past a quota for up to one interval before it is blocked, and a raised limit unblocks it within one interval.
