import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';
import type { OrgRole } from '@logtide/shared';
import type { HookRegistry } from '../hooks/registry.js';
import type { CronJobDefinition } from '../queue/abstractions/types.js';
import type {
  EntitlementInput,
  getOrganizationEntitlements,
} from '../modules/capabilities/entitlements-service.js';

/** Version of the extension API contract. Bump on breaking changes. */
export const EXTENSION_API_VERSION = 1;

/** Process an extension is being registered in. */
export type ExtensionProcess = 'server' | 'worker';

/** Prefixed logger handed to an extension (`[ext:<name>]`). */
export interface ExtensionLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Route-level auth helpers for extension routes. */
export interface ExtensionAuth {
  /** Session auth (same as core `authenticate`): 401 without a valid session. */
  requireSession: preHandlerHookHandler;
  /**
   * Session auth + membership check on `:orgId`. Malformed orgId or non
   * member: 404 `{ error: 'not_found' }`; role not allowed: 403
   * `{ error: 'forbidden' }`. On success sets `request.extOrg`.
   */
  requireOrgRole(roles: OrgRole[]): preHandlerHookHandler[];
}

/** Queue job registered by an extension (populated by the worker runtime). */
export interface ExtensionJob {
  queue: string;
  handler: (data: unknown) => Promise<void>;
}

/** Cron registered by an extension. */
export type ExtensionCron = CronJobDefinition;

/**
 * Surface handed to an extension's register(). Members are added by the
 * runtime tasks that implement them.
 */
export interface ExtensionApi {
  /** Extension name (also its Postgres schema name and route prefix). */
  readonly name: string;
  /** Logger with an `[ext:<name>]` prefix. */
  readonly logger: ExtensionLogger;
  /** The core lifecycle hook registry. */
  readonly hooks: HookRegistry;
  /** Public frontend URL without trailing slash, null when FRONTEND_URL is unset. */
  readonly appUrl: string | null;
  /** Route-level auth helpers. */
  readonly auth: ExtensionAuth;
  /**
   * Register a Fastify plugin mounted under `/api/v1/ext/<name>`. The plugin
   * is encapsulated: parsers, hooks and decorators stay inside it. Routes
   * skip the global API key/session plugin, so each route must pick its own
   * auth (`api.auth.*`) or verify the request itself.
   */
  routes(plugin: FastifyPluginAsync): void;
  /** Values exposed under `extensions.<name>` in `GET /api/v1/auth/config`. */
  publicConfig(fn: () => Record<string, unknown> | Promise<Record<string, unknown>>): void;
  /**
   * Core database connection and the extension's own Postgres schema
   * (`schema` = extension name). Extension tables live only in that schema.
   */
  readonly database: { url: string; schema: string };
  /**
   * Register a folder of `.sql` migrations for the extension schema (at most
   * once). Applied by initExtensions after every register(), in file name
   * order, each file at most once, with search_path set to the schema.
   */
  migrate(dir: string): void;
  readonly entitlements: ExtensionEntitlements;
  readonly retention: ExtensionRetention;
  readonly orgs: ExtensionOrgs;
  readonly queue: ExtensionQueue;
  readonly mail: ExtensionMail;
}

/** Background jobs and cron schedules. Queue names are `ext:<name>:<job>`. */
export interface ExtensionQueue {
  /** Register the handler of a job. Inside register() only; worker process runs it. */
  registerJob<T = unknown>(job: string, handler: (data: T) => Promise<void>): void;
  /** Enqueue a job of this extension. Completed and failed jobs are always removed. */
  enqueue<T = unknown>(
    job: string,
    data: T,
    opts?: { delayMs?: number; jobKey?: string }
  ): Promise<void>;
  /** Run a registered job on a cron expression. Inside register() only. */
  schedule(job: string, cronExpression: string): void;
}

/** Thrown by `mail.send` when SMTP_HOST is not configured. */
export class MailNotConfiguredError extends Error {
  constructor() {
    super('[Extensions] Mail is not configured (SMTP_HOST is unset)');
    this.name = 'MailNotConfiguredError';
  }
}

export interface ExtensionMailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

/** Outbound mail through the core SMTP settings. */
export interface ExtensionMail {
  send(msg: ExtensionMailMessage): Promise<void>;
}

/** Org entitlements, delegating to the core service with actor `ext:<name>`. */
export interface ExtensionEntitlements {
  get(orgId: string): ReturnType<typeof getOrganizationEntitlements>;
  set(orgId: string, inputs: EntitlementInput[]): Promise<{ updated: number }>;
  /** Remove the explicit override so the org inherits the default again. */
  reset(orgId: string, capability: string): Promise<{ removed: boolean }>;
}

/** Org retention policy, delegating to the core service with actor `ext:<name>`. */
export interface ExtensionRetention {
  get(orgId: string): Promise<Record<string, unknown>>;
  set(
    orgId: string,
    input: { retentionDays?: number; auditRetentionDays?: number | null }
  ): Promise<Record<string, unknown>>;
}

/** Read-only organization lookups. Malformed ids behave like missing ones. */
export interface ExtensionOrgs {
  get(orgId: string): Promise<{ id: string; name: string } | null>;
  listOwnersAndAdmins(
    orgId: string
  ): Promise<Array<{ userId: string; email: string; role: 'owner' | 'admin' }>>;
}

export interface LogtideExtension {
  /** Must match ^[a-z][a-z0-9_]{1,30}$ */
  name: string;
  apiVersion: number;
  register(api: ExtensionApi): void | Promise<void>;
}
