# Extensions

An extension is an ES module that adds routes, database tables, background jobs and settings pages to a LogTide instance without changing the LogTide source. Operators who host LogTide for other people use extensions to add features of their own on top of the core.

Without `LOGTIDE_EXTENSIONS` set, nothing is loaded and LogTide behaves exactly as before.

A complete working example is in [`docs/examples/extension-example.mjs`](examples/extension-example.mjs).

## Loading extensions

Set `LOGTIDE_EXTENSIONS` to a comma-separated list of module paths. Set it for both the `backend` and the `worker` process: the server mounts routes and public config, the worker runs jobs and crons, and both apply migrations at boot.

```
LOGTIDE_EXTENSIONS=/opt/logtide/ext/first.mjs,/opt/logtide/ext/second.mjs
```

Any failure (missing file, bad shape, wrong name, wrong `apiVersion`, duplicate name, an error thrown from `register()` or from a migration) aborts startup with a message starting with `[Extensions]`. This is the same policy as `HOOKS_MODULES`.

## Module shape

The module default-exports an object:

```js
export default {
  name: 'example',   // must match ^[a-z][a-z0-9_]{1,30}$
  apiVersion: 1,     // must equal EXTENSION_API_VERSION
  register(api) {},  // may be async
};
```

`name` is used as the Postgres schema name, the route prefix and the prefix of queue names, so it must be unique across loaded extensions.

## API version and compatibility

`EXTENSION_API_VERSION` is currently `1`. An extension whose `apiVersion` differs from the running core's value is rejected at boot. The version is bumped only on breaking changes to the contract below (a removed or changed member). New members may be added without a bump, so an extension should only rely on members documented here.

## No internal backend imports

An extension must not import anything from the backend source tree (`packages/backend/src/...`), which has no stability guarantee. Everything it needs is on the `api` object passed to `register()`. TypeScript authors can use the types in `packages/backend/src/extensions/types.ts`, but only as type-only imports. The module can import its own dependencies (for example a database driver) like any other Node module.

## The `ExtensionApi` object

`register(api)` receives the following members. The registration methods (`routes`, `publicConfig`, `migrate`, `queue.registerJob`, `queue.schedule`) throw if called after `register()` has returned, and `migrate()` and `publicConfig()` may be called only once per extension. The other members can be used at any time.

| Member | Signature | Notes |
|---|---|---|
| `name` | `readonly string` | The extension name |
| `logger` | `{ debug, info, warn, error }(...args)` | Prefixed with `[ext:<name>]` |
| `hooks` | `HookRegistry` | The core lifecycle hook registry |
| `appUrl` | `readonly string \| null` | Public frontend URL without trailing slash, `null` when `FRONTEND_URL` is unset |
| `auth` | `ExtensionAuth` | Route-level auth helpers, see below |
| `routes` | `routes(plugin: FastifyPluginAsync): void` | Mount a Fastify plugin under `/api/v1/ext/<name>` |
| `publicConfig` | `publicConfig(fn: () => Record<string, unknown> \| Promise<Record<string, unknown>>): void` | Values exposed under `extensions.<name>` in `GET /api/v1/auth/config` |
| `database` | `readonly { url: string; schema: string }` | Core connection string and the extension's own schema (equal to `name`) |
| `migrate` | `migrate(dir: string): void` | Register a folder of `.sql` migrations |
| `entitlements` | `{ get, set, reset }` | Organization entitlements |
| `retention` | `{ get, set }` | Organization retention policy |
| `orgs` | `{ get, listOwnersAndAdmins }` | Read-only organization lookups |
| `queue` | `{ registerJob, enqueue, schedule }` | Background jobs and crons |
| `mail` | `{ send }` | Outbound mail |

### Prefixes at a glance

| What | Value |
|---|---|
| Route prefix | `/api/v1/ext/<name>` |
| Postgres schema | `<name>` |
| Queue and cron name | `ext:<name>:<job>` |
| Audit actor | `ext:<name>` |
| Log prefix | `[ext:<name>]` |

BullMQ does not allow `:` in queue names, so the Redis backend stores `ext:<name>:<job>` with each `:` mapped to `__`. You always use the `ext:` form in code and logs.

### `routes(plugin)`

The plugin is a regular Fastify plugin, registered encapsulated: content type parsers, hooks and decorators you add inside it never affect core routes (for example you can register a raw-body JSON parser for a webhook). Everything is mounted under `/api/v1/ext/<name>`.

Extension routes skip the global API key and session plugin. A route with no auth of its own is therefore public. Each route must use `api.auth.*` below or verify the request itself (for example a webhook signature).

### `auth`

```ts
interface ExtensionAuth {
  requireSession: preHandlerHookHandler;
  requireOrgRole(roles: OrgRole[]): preHandlerHookHandler[];
}
```

- `requireSession`: session auth, same as the core. `401` without a valid session.
- `requireOrgRole(roles)`: use as `preHandler`. Authenticates the session, then checks membership on the `:orgId` route parameter. A malformed UUID or a user who is not a member answers `404 { "error": "not_found" }`; a member whose role is not in `roles` answers `403 { "error": "forbidden" }`. On success `request.extOrg` is `{ id, role }`.

`OrgRole` is `'owner' | 'admin' | 'member'`.

### `publicConfig(fn)`

`fn` is called on every `GET /api/v1/auth/config` and its result appears under `extensions.<name>`. The endpoint is unauthenticated, so return only values that are safe to show to anyone. If `fn` throws, the error is logged and that extension is left out of the response.

### `database` and `migrate(dir)`

`database.url` is the core connection string; `database.schema` is the extension's schema. Extension tables live only in that schema. Open your own connection with a driver of your choice.

`migrate(dir)` registers a folder of `.sql` files. After all extensions have registered, the runtime creates the schema if needed and applies the files in file name order, each file at most once, recording applied names in `<schema>.schema_migrations`. The server and the worker booting together are serialized, so every file is applied once.

Limits you need to know:

- All files of one run are applied in a single transaction, with a savepoint per file, under a transaction-level advisory lock. If a file fails, that file is rolled back, the files before it stay applied, and startup aborts naming the file.
- Because of that, files must not contain `BEGIN`, `COMMIT` or `ROLLBACK`, cannot use `CREATE INDEX CONCURRENTLY`, and cannot add an enum value and use it in a later file of the same run.
- `search_path` during a migration is the extension schema only. Reference core tables and functions in `public` with a schema qualifier (`public.organizations`, `public.some_function()`).
- A file may contain several statements.

### `entitlements`

Delegates to the core entitlement service, recorded with actor `ext:<name>`.

```ts
get(orgId: string): ReturnType<typeof getOrganizationEntitlements>
set(orgId: string, inputs: EntitlementInput[]): Promise<{ updated: number }>
reset(orgId: string, capability: string): Promise<{ removed: boolean }>
```

`reset` removes the explicit override so the organization inherits the default again.

### `retention`

Delegates to the core retention service, recorded with actor `ext:<name>`.

```ts
get(orgId: string): Promise<Record<string, unknown>>
set(orgId: string, input: { retentionDays?: number; auditRetentionDays?: number | null }): Promise<Record<string, unknown>>
```

### `orgs`

Read-only lookups. A malformed id behaves like a missing one.

```ts
get(orgId: string): Promise<{ id: string; name: string } | null>
listOwnersAndAdmins(orgId: string): Promise<Array<{ userId: string; email: string; role: 'owner' | 'admin' }>>
```

### `queue`

```ts
registerJob<T>(job: string, handler: (data: T) => Promise<void>): void
enqueue<T>(job: string, data: T, opts?: { delayMs?: number; jobKey?: string }): Promise<void>
schedule(job: string, cronExpression: string): void
```

- `registerJob` and `schedule` work inside `register()` only. The handler runs in the worker process. Registering the same job name twice throws.
- `schedule` runs a job on a cron expression (five-field syntax). The job is enqueued with an empty payload, and the cron is registered in the worker process.
- `enqueue` adds a job to its queue from any process. `jobKey` deduplicates; `delayMs` delays execution. Completed and failed jobs are always removed.
- The queue name of a job is `ext:<name>:<job>`.

### `mail`

```ts
send(msg: { to: string | string[]; subject: string; text: string; html?: string }): Promise<void>
```

Sends through the core SMTP settings. It rejects with `MailNotConfiguredError` when `SMTP_HOST` is unset.

## Frontend extensions

The frontend has a registry at `packages/frontend/src/lib/extensions/`. In the stock build `index.ts` exports an empty `extensions` array. A custom build replaces that file (for example by copying an overlay over it before `pnpm build`) with its own list of `FrontendExtension` objects:

```ts
interface FrontendExtension {
  name: string;
  /** Receives the auth config; the backend values are under cfg.extensions[name]. */
  isEnabled(cfg: AuthConfig): boolean;
  settingsNav?: ExtensionSettingsItem[];
  /** Where the Usage page upgrade buttons point. */
  upgradeTarget?: { href: string };
}

interface ExtensionSettingsItem extends SettingsNavItem {
  group: 'Account' | 'Organization' | 'Data' | 'Notifications';
  after?: string;      // id of the core item to insert after; absent = end of the group
  keywords?: string[]; // extra command palette search words
}
```

Only extensions whose `isEnabled(cfg)` returns true contribute. Their `settingsNav` items appear in the settings navigation and the command palette. The first active extension that defines `upgradeTarget` decides where the Usage page upgrade buttons point. Pages themselves are ordinary SvelteKit routes added by the same overlay. A typical `isEnabled` reads the extension's `publicConfig` values:

```ts
isEnabled: (cfg) => cfg.extensions?.example?.enabled === true
```

## Related

- [Hosting LogTide for others](cloud-seams.md): environment variables for operators who run LogTide for other people.
