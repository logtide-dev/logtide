import path from 'path';
import { pathToFileURL } from 'url';
import { config } from '../config/index.js';
import { EXTENSION_API_VERSION, type LogtideExtension } from './types.js';

const NAME_RE = /^[a-z][a-z0-9_]{1,30}$/;

/**
 * Load extension modules listed in LOGTIDE_EXTENSIONS (comma-separated paths).
 * Each module default-exports a LogtideExtension. Any failure is FATAL at
 * boot, same policy as HOOKS_MODULES.
 */
export async function loadExtensionModules(
  spec: string | undefined = config.LOGTIDE_EXTENSIONS
): Promise<LogtideExtension[]> {
  if (!spec) return [];
  const paths = spec
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const loaded: LogtideExtension[] = [];
  const seen = new Set<string>();

  for (const modulePath of paths) {
    const resolved = path.resolve(modulePath);
    let mod: { default?: unknown };
    try {
      mod = await import(pathToFileURL(resolved).href);
    } catch (err) {
      throw new Error(
        `[Extensions] Failed to load module ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
    const ext = mod.default as Partial<LogtideExtension> | undefined;
    if (!ext || typeof ext !== 'object' || typeof ext.register !== 'function') {
      throw new Error(
        `[Extensions] Module ${resolved} must default-export an extension object with a register() function`
      );
    }
    if (typeof ext.name !== 'string' || !NAME_RE.test(ext.name)) {
      throw new Error(
        `[Extensions] Module ${resolved} has invalid extension name '${String(ext.name)}' (must match ${NAME_RE})`
      );
    }
    if (ext.apiVersion !== EXTENSION_API_VERSION) {
      throw new Error(
        `[Extensions] Module ${resolved} (extension '${ext.name}') has apiVersion ${String(ext.apiVersion)}, expected ${EXTENSION_API_VERSION}`
      );
    }
    if (seen.has(ext.name)) {
      throw new Error(`[Extensions] Module ${resolved}: duplicate extension name '${ext.name}'`);
    }
    seen.add(ext.name);
    loaded.push(ext as LogtideExtension);
  }
  return loaded;
}
