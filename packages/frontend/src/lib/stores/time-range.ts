import { writable } from 'svelte/store';
import {
  DEFAULT_RANGE,
  legacyTimeRangeToRange,
  rangeToLegacyTimeRange,
  rangesEqual,
  scopeStore,
} from './scope.js';

// Deprecated facade, removed in Wave D once pages adopt ScopeBar.
// Maps the shared scope range to the old { type, from, to } shape for pages
// that have not migrated. Consumers validate `type` against what they support
// and fall back otherwise. State and persistence live in scopeStore (key
// logtide_scope); this store no longer writes its old localStorage key.

export interface StoredTimeRange {
  type: string;
  from: string;
  to: string;
}

// The exact legacy value last set through this facade. Returned as long as it
// still maps to the current scope range, so a custom value echoes back
// unchanged (no round trip through ISO) within the session.
let lastLegacy: StoredTimeRange | null = null;

function compute(): StoredTimeRange | null {
  const range = scopeStore.get().range;
  if (lastLegacy) {
    const mapped = legacyTimeRangeToRange(lastLegacy);
    if (mapped && rangesEqual(mapped, range)) return lastLegacy;
  }
  return rangeToLegacyTimeRange(range);
}

const view = writable<StoredTimeRange | null>(compute());
scopeStore.subscribe(() => view.set(compute()));

export const timeRangeStore = {
  subscribe: view.subscribe,
  set: (value: StoredTimeRange | null) => {
    lastLegacy = value;
    scopeStore.setRange((value && legacyTimeRangeToRange(value)) || DEFAULT_RANGE);
    // The scope may not have changed (equal range), so refresh explicitly.
    view.set(compute());
  },
  get: (): StoredTimeRange | null => compute(),
};
