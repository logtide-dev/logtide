import type { PaletteContext, PaletteGroup, PaletteItem, PaletteProvider } from './types';

/**
 * Pluggable command palette sources. Providers load lazily (when the palette
 * opens), per organization, and one failing or slow provider never blocks the
 * others. Reserved orders: navigation 10, actions 20, projects 30, saved
 * searches 35, dashboards 40, incidents 45, monitors 50, alert rules 60,
 * settings 70.
 */

export const PROVIDER_TIMEOUT_MS = 4000;
export const DEFAULT_TTL_MS = 60000;
export const MAX_ITEMS_PER_GROUP = 50;

const providers = new Map<string, PaletteProvider>();
const cache = new Map<string, { at: number; items: PaletteItem[] }>();

function dropCacheFor(providerId: string) {
  const prefix = `${providerId}:`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function registerPaletteProvider(provider: PaletteProvider): () => void {
  providers.set(provider.id, provider);
  dropCacheFor(provider.id);
  return () => {
    // Only remove our own registration, not a replacement registered later.
    if (providers.get(provider.id) === provider) {
      providers.delete(provider.id);
      dropCacheFor(provider.id);
    }
  };
}

export function listPaletteProviders(): PaletteProvider[] {
  return [...providers.values()].sort((a, b) => a.order - b.order);
}

export function clearPaletteCache(): void {
  cache.clear();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Palette provider timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function loadOne(provider: PaletteProvider, ctx: PaletteContext): Promise<PaletteGroup | null> {
  if (provider.needsOrganization && !ctx.organizationId) return null;

  const ttl = provider.ttlMs ?? DEFAULT_TTL_MS;
  const key = `${provider.id}:${ctx.organizationId ?? ''}`;

  if (ttl > 0) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) {
      return { provider: provider.id, heading: provider.heading, items: hit.items };
    }
  }

  try {
    const result = await withTimeout(Promise.resolve().then(() => provider.items(ctx)), PROVIDER_TIMEOUT_MS);
    const items = (Array.isArray(result) ? result : []).slice(0, MAX_ITEMS_PER_GROUP);

    // The organization or the palette moved on while this was loading: drop it.
    if (ctx.signal.aborted) {
      return { provider: provider.id, heading: provider.heading, items: [], failed: true };
    }
    if (ttl > 0) cache.set(key, { at: Date.now(), items });
    return { provider: provider.id, heading: provider.heading, items };
  } catch {
    return { provider: provider.id, heading: provider.heading, items: [], failed: true };
  }
}

export async function loadPaletteGroups(ctx: PaletteContext): Promise<PaletteGroup[]> {
  const settled = await Promise.all(listPaletteProviders().map((p) => loadOne(p, ctx)));
  return settled.filter((g): g is PaletteGroup => g !== null);
}
