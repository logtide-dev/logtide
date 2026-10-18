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
| `REQUIRE_EMAIL_VERIFICATION` | `false` | Require new local users to confirm their email |
| `REGISTRATION_RATE_LIMIT_PER_HOUR` | unset (off) | Extra per-IP cap on registrations over one hour |

An empty string is treated the same as unset for all of them.

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

`limitValue` is an integer `>= 0` or `null`; boolean capabilities use `enabled`. Unknown capabilities are rejected with `400`.

### Upgrade handoff (LOGTIDE_UPGRADE_URL and LOGTIDE_UPGRADE_SIGNING_SECRET)

These two enable a signed redirect to an external billing portal. They must be set together:

- Only one set aborts startup.
- `LOGTIDE_UPGRADE_URL` must be an absolute `https` URL (`http` is accepted only for `localhost` and `127.0.0.1`).
- `LOGTIDE_UPGRADE_SIGNING_SECRET` must be at least 32 characters.

When active:

- `POST /api/v1/organizations/:id/upgrade-handoff` exists (it is not registered at all otherwise). Body: `{ "intent": "upgrade" | "manage" }`. Only owners and admins of the organization may call it (`403` otherwise). It returns `{ "url": "..." }`, which is `LOGTIDE_UPGRADE_URL` with the token in the `t` query parameter (an existing query string is preserved).
- `GET /api/v1/auth/config` includes `upgradeEnabled: true`, and the Usage page shows Upgrade / Manage billing buttons to owners and admins.
- Capability (`403`) and quota (`429`) denials include `upgrade_available: true` in the body.

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

### REQUIRE_EMAIL_VERIFICATION

`true` or `false` (default `false`); any other value aborts startup. **`true` requires `SMTP_HOST`**, otherwise startup fails, because no verification email could be sent.

When `true`:

- Newly registered local users are still signed in immediately and receive an email with a link to `/verify-email?token=...`. The token is 32 random bytes, stored only as a SHA-256 hash, single use, valid 24 hours.
- Until verified, `POST /api/v1/projects` and `POST /api/v1/projects/:id/api-keys` answer `403 { "error": "email_not_verified" }`. This check runs before the `projects.max` limit check.
- New routes: `POST /api/v1/auth/verify-email` (`400 invalid_or_expired_token` for unknown, reused, expired or someone else's token) and `POST /api/v1/auth/resend-verification` (always `202`, so it does not reveal whether an address exists; limited to 5 per hour per IP and a 60 second per-user cooldown).
- `GET /api/v1/auth/config` includes `emailVerificationRequired: true`; `GET /api/v1/auth/me` includes `user.emailVerified`. The app shows a "Verify your email" banner.
- OIDC users count as verified when the identity provider asserts `email_verified: true` for the current address. Admin-created, LDAP and bootstrap users are verified. Changing the email address requires verifying again.
- Existing users are backfilled as verified, so enabling the flag never locks anyone out.

When `false`, the verification routes are not registered and every user counts as verified.

### REGISTRATION_RATE_LIMIT_PER_HOUR

Positive integer; unset = off; anything else aborts startup. Caps `POST /api/v1/auth/register` per client IP over a one-hour window, on top of `AUTH_RATE_LIMIT_REGISTER`. It is keyed by IP only, so a forged `Authorization` header cannot rotate the counter. Over the cap the route answers `429` with a `Retry-After` header. It needs the rate-limit plugin; if that is not registered a warning is logged and the cap is not applied. Behind a reverse proxy make sure client IPs are resolved correctly, otherwise every request shares one IP.

## Capabilities added for hosting

All three default to unlimited and can be set per organization through entitlements, through the admin API, or globally through `CAPABILITY_DEFAULTS_JSON`.

| Capability | Kind | Meaning |
|---|---|---|
| `projects.max` | limit | Maximum number of active projects (soft-deleted ones do not count). Enforced on `POST /api/v1/projects`, answers `403` at the limit |
| `quota.grace_percent` | limit | Overage allowed above every quota of the organization before hard-blocking. `null` or `0` means no grace |
| `metrics.max_datapoints_monthly` | quota | Month-to-date ingested OTLP metric datapoints. Over the limit `POST /v1/otlp/metrics` answers `429` while logs and spans keep flowing |

Metric datapoints are now metered as the `metrics.ingested.datapoints` usage type (only datapoints that were actually stored). Like spans, this follows `METERING_ENABLED`.

## Quota behavior

Quotas (`ingestion.max_bytes_monthly`, spans, metric datapoints and so on) are consumption caps that reset on the first day of each calendar month, UTC.

- A background evaluator (`QUOTA_EVALUATOR_INTERVAL_MS`, default 60 seconds, disable with `QUOTA_EVALUATOR_ENABLED=false`) recomputes usage and decides the state, so blocking can lag by up to one interval.
- A quota is `ok` below its limit, in `grace` from the limit up to `limit * (1 + grace_percent / 100)`, and `blocked` from that ceiling on. With no grace the first state past the limit is `blocked`. Ingestion is rejected only when `blocked`; blocked requests answer `429`.
- The first time a quota enters `grace` or becomes `blocked` within a UTC month, organization owners and admins get an in-app notification and an email (the email needs SMTP; a failed email never breaks the evaluator). Each organization, capability and state is notified at most once per month.
- The Usage page shows "In grace" and "Blocked" badges. The capability usage API returns a `state` for quota rows.
