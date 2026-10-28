import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config/index.js';
import { hooks } from '../hooks/facade.js';
import { extensionAuth } from './auth.js';
import type {
  ExtensionApi,
  ExtensionCron,
  ExtensionJob,
  ExtensionLogger,
  ExtensionProcess,
  LogtideExtension,
} from './types.js';

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

function createExtensionApi(name: string, state: RuntimeState): ExtensionApi {
  const assertRegistering = (method: string) => {
    if (!state.registering) {
      throw new Error(`[Extensions] ${method}() must be called inside register()`);
    }
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
      names.push(mod.name);
    }
  } finally {
    state.registering = false;
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
