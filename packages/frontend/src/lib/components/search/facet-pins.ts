// Metadata keys the user pinned to the facet sidebar, per project, in this
// browser. Storage failures (private mode, quota) never break the sidebar:
// the in-memory list stays authoritative.

import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';
import { MAX_METADATA_FACETS } from './facet-keys';

const storageKey = (projectKey: string) => `logtide:facet-pins:${projectKey}`;

/** Strings only, deduped, at most `MAX_METADATA_FACETS`, first pins kept. */
function normalizePins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item === '' || out.includes(item)) continue;
    if (out.length >= MAX_METADATA_FACETS) break;
    out.push(item);
  }
  return out;
}

function readPins(projectKey: string): string[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(storageKey(projectKey));
    return normalizePins(raw ? JSON.parse(raw) : null);
  } catch {
    return [];
  }
}

function writePins(projectKey: string, pins: string[]): void {
  if (!browser) return;
  try {
    localStorage.setItem(storageKey(projectKey), JSON.stringify(pins));
  } catch {
    // blocked or full storage: the in-memory value stays authoritative
  }
}

export type FacetPinsStore = Writable<string[]> & { pin(key: string): void; unpin(key: string): void };

/** Pins persisted under `logtide:facet-pins:<projectKey>`; a pin past the cap of 8 is ignored. */
export function createFacetPinsStore(projectKey: string): FacetPinsStore {
  const store = writable<string[]>(readPins(projectKey));
  const update = (updater: (pins: string[]) => string[]) => {
    store.update((current) => {
      const next = normalizePins(updater(current));
      writePins(projectKey, next);
      return next;
    });
  };
  return {
    subscribe: store.subscribe,
    set(value) {
      const next = normalizePins(value);
      writePins(projectKey, next);
      store.set(next);
    },
    update,
    pin(key) {
      update((pins) => (pins.includes(key) ? pins : [...pins, key]));
    },
    unpin(key) {
      update((pins) => pins.filter((k) => k !== key));
    },
  };
}
