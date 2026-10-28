import type { FastifyPluginAsync } from 'fastify';
import path from 'path';
import { config } from '../config/index.js';
import { db } from '../database/index.js';
import { hooks } from '../hooks/facade.js';
import {
  getOrganizationEntitlements,
  resetOrganizationEntitlement,
  setOrganizationEntitlements,
} from '../modules/capabilities/entitlements-service.js';
import { getMailer } from '../lib/mailer.js';
import { createQueue } from '../queue/connection.js';
import { retentionService } from '../modules/retention/service.js';
import { extensionAuth, UUID_RE } from './auth.js';
import { runExtensionMigrations } from './migrate.js';
import type {
  ExtensionApi,
  ExtensionCron,
  ExtensionJob,
  ExtensionLogger,
  ExtensionMail,
  ExtensionQueue,
  ExtensionOrgs,
  ExtensionProcess,
  LogtideExtension,
} from './types.js';
import { MailNotConfiguredError } from './types.js';

/** Job names end up in queue ids `ext:<name>:<job>`, so no `:` and no `__`. */
const JOB_NAME_RE = /^[a-z][a-z0-9_-]{0,62}$/;

function assertJobName(method: string, job: unknown): void {
  if (typeof job !== 'string' || !JOB_NAME_RE.test(job) || job.includes('__')) {
    throw new Error(
      `[Extensions] ${method}(): invalid job name '${String(job)}' (must match ${JOB_NAME_RE} and not contain '__')`
    );
  }
}

type PublicConfigFn = () => Record<string, unknown> | Promise<Record<string, unknown>>;

/** Everything the extensions registered, consumed by server.ts and worker.ts. */
export interface ExtensionRuntime {
  /** Names of the registered extensions, in registration order. */
  extensions: string[];
  /** Route plugins, mounted by build() under `/api/v1/ext/<name>`. */
  routes: Array<{ name: string; plugin: FastifyPluginAsync }>;
  /** Resolves every registered publicConfig fn, keyed by extension name. */
  publicConfig(): Promise<Record<string, Record<string, unknown>>>;
  jobs: ExtensionJob[];
  crons: ExtensionCron[];
}

/** Mutable state shared by the per-extension APIs while register() runs. */
interface RuntimeState {
  routes: ExtensionRuntime['routes'];
  publicConfigFns: Map<string, PublicConfigFn>;
  jobs: ExtensionJob[];
  crons: ExtensionCron[];
  /** Migration folder per extension, applied after every register(). */
  migrations: Map<string, string>;
  /** False once initExtensions returns: late registrations would be lost. */
  registering: boolean;
}

function createLogger(name: string): ExtensionLogger {
  const prefix = `[ext:${name}]`;
  return {
    debug: (...args) => console.debug(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

function resolveAppUrl(): string | null {
  return config.FRONTEND_URL ? config.FRONTEND_URL.replace(/\/+$/, '') : null;
}

// Malformed ids are answered like missing ones (never a Postgres cast error).
const extensionOrgs: ExtensionOrgs = {
  async get(orgId) {
    if (!UUID_RE.test(orgId)) return null;
    const org = await db
      .selectFrom('organizations')
      .select(['id', 'name'])
      .where('id', '=', orgId)
      .executeTakeFirst();
    return org ?? null;
  },
  async listOwnersAndAdmins(orgId) {
    if (!UUID_RE.test(orgId)) return [];
    const rows = await db
      .selectFrom('organization_members')
      .innerJoin('users', 'users.id', 'organization_members.user_id')
      .select(['users.id as userId', 'users.email', 'organization_members.role'])
      .where('organization_members.organization_id', '=', orgId)
      .where('organization_members.role', 'in', ['owner', 'admin'])
      .orderBy('organization_members.role', 'desc')
      .orderBy('users.email')
      .execute();
    return rows.map((r) => ({ userId: r.userId, email: r.email, role: r.role as 'owner' | 'admin' }));
  },
};

const extensionMail: ExtensionMail = {
  async send(msg) {
    const mailer = getMailer();
    if (!mailer) throw new MailNotConfiguredError();
    await mailer.sendMail({
      from: config.SMTP_FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  },
};

function createExtensionApi(name: string, state: RuntimeState): ExtensionApi {
  const assertRegistering = (method: string) => {
    if (!state.registering) {
      throw new Error(`[Extensions] ${method}() must be called inside register()`);
    }
  };
  const actor = `ext:${name}`;
  const queueName = (job: string) => `ext:${name}:${job}`;
  const queue: ExtensionQueue = {
    registerJob(job, handler) {
      assertRegistering('registerJob');
      assertJobName('registerJob', job);
      const queueId = queueName(job);
      if (state.jobs.some((j) => j.queue === queueId)) {
        throw new Error(`[Extensions] Job '${queueId}' is registered more than once`);
      }
      state.jobs.push({ queue: queueId, handler: handler as (data: unknown) => Promise<void> });
    },
    async enqueue(job, data, opts) {
      assertJobName('enqueue', job);
      await createQueue(queueName(job)).add(job, data, {
        delay: opts?.delayMs,
        jobKey: opts?.jobKey,
        removeOnComplete: true,
        removeOnFail: true,
      });
    },
    schedule(job, cronExpression) {
      assertRegistering('schedule');
      assertJobName('schedule', job);
      const id = queueName(job);
      if (state.crons.some((c) => c.identifier === id)) {
        throw new Error(`[Extensions] Job '${id}' is scheduled more than once`);
      }
      state.crons.push({ task: id, cronExpression, payload: {}, identifier: id });
    },
  };

  return {
    name,
    logger: createLogger(name),
    hooks,
    appUrl: resolveAppUrl(),
    auth: extensionAuth,
    routes(plugin) {
      assertRegistering('routes');
      state.routes.push({ name, plugin });
    },
    publicConfig(fn) {
      assertRegistering('publicConfig');
      if (state.publicConfigFns.has(name)) {
        throw new Error(`[Extensions] Extension '${name}' called publicConfig() more than once`);
      }
      state.publicConfigFns.set(name, fn);
    },
    database: { url: config.DATABASE_URL, schema: name },
    migrate(dir) {
      assertRegistering('migrate');
      if (state.migrations.has(name)) {
        throw new Error(`[Extensions] Extension '${name}' called migrate() more than once`);
      }
      state.migrations.set(name, path.resolve(dir));
    },
    entitlements: {
      get: (orgId) => getOrganizationEntitlements(orgId),
      set: (orgId, inputs) => setOrganizationEntitlements(orgId, inputs, actor),
      reset: (orgId, capability) => resetOrganizationEntitlement(orgId, capability, actor),
    },
    retention: {
      get: (orgId) => retentionService.getOrganizationRetentionPolicy(orgId),
      set: (orgId, input) => retentionService.setOrganizationRetentionPolicy(orgId, input, actor),
    },
    orgs: extensionOrgs,
    queue,
    mail: extensionMail,
  };
}

/**
 * Call register() of each extension in order and collect what it registered.
 * Any register() failure is fatal (same policy as module loading).
 */
export async function initExtensions(
  mods: LogtideExtension[],
  proc: ExtensionProcess
): Promise<ExtensionRuntime> {
  const state: RuntimeState = {
    routes: [],
    publicConfigFns: new Map(),
    jobs: [],
    crons: [],
    migrations: new Map(),
    registering: true,
  };
  const names: string[] = [];

  try {
    for (const mod of mods) {
      const api = createExtensionApi(mod.name, state);
      try {
        await mod.register(api);
      } catch (err) {
        throw new Error(
          `[Extensions] Extension '${mod.name}' failed to register (${proc}): ${err instanceof Error ? err.message : String(err)}`,
          { cause: err }
        );
      }
      // Checked after register() returns: registerJob may follow schedule.
      const prefix = `ext:${mod.name}:`;
      for (const cron of state.crons) {
        if (cron.task.startsWith(prefix) && !state.jobs.some((j) => j.queue === cron.task)) {
          throw new Error(
            `[Extensions] Extension '${mod.name}' scheduled job '${cron.task.slice(prefix.length)}' (${proc}) without registering it with registerJob()`
          );
        }
      }
      names.push(mod.name);
    }
  } finally {
    state.registering = false;
  }

  // After every register(): server and worker both get here at boot, the
  // advisory lock in runExtensionMigrations serializes them per schema.
  for (const [name, dir] of state.migrations) {
    try {
      const applied = await runExtensionMigrations(name, dir);
      if (applied.length > 0) {
        console.log(`[ext:${name}] Applied migrations (${proc}): ${applied.join(', ')}`);
      }
    } catch (err) {
      throw new Error(
        `[Extensions] Extension '${name}' failed to migrate (${proc}): ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
  }

  if (names.length > 0) {
    console.log(`[Extensions] Registered in ${proc}: ${names.join(', ')}`);
  }

  return {
    extensions: names,
    routes: state.routes,
    jobs: state.jobs,
    crons: state.crons,
    async publicConfig() {
      const out: Record<string, Record<string, unknown>> = {};
      for (const [name, fn] of state.publicConfigFns) {
        // One failing extension must not take down the whole auth config.
        try {
          out[name] = await fn();
        } catch (err) {
          console.error(`[ext:${name}] publicConfig() failed:`, err);
        }
      }
      return out;
    },
  };
}
