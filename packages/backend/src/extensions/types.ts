import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';
import type { OrgRole } from '@logtide/shared';
import type { HookRegistry } from '../hooks/registry.js';
import type { CronJobDefinition } from '../queue/abstractions/types.js';

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
}

export interface LogtideExtension {
  /** Must match ^[a-z][a-z0-9_]{1,30}$ */
  name: string;
  apiVersion: number;
  register(api: ExtensionApi): void | Promise<void>;
}
