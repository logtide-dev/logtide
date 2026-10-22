// Order and visibility of the built-in results columns (spec 5.4 "Columns"),
// stored per project in this browser. Custom metadata columns live in
// `$lib/stores/column-config` as before.

import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';

export const BUILTIN_COLUMNS = ['time', 'project', 'service', 'host', 'level', 'message'] as const;
export type BuiltinColumn = (typeof BUILTIN_COLUMNS)[number];

export const BUILTIN_COLUMN_LABELS: Record<BuiltinColumn, string> = {
  time: 'Time',
  project: 'Project',
  service: 'Service',
  host: 'Host',
  level: 'Level',
  message: 'Message',
};

export interface BuiltinColumnLayout {
  order: BuiltinColumn[];
  hidden: BuiltinColumn[];
}

/** The message column takes the remaining width and can never be hidden. */
const ALWAYS_VISIBLE: BuiltinColumn = 'message';

export const DEFAULT_BUILTIN_LAYOUT: BuiltinColumnLayout = Object.freeze({
  order: [...BUILTIN_COLUMNS],
  hidden: [],
}) as BuiltinColumnLayout;

function isBuiltinColumn(value: unknown): value is BuiltinColumn {
  return typeof value === 'string' && (BUILTIN_COLUMNS as readonly string[]).includes(value);
}

function knownUnique(raw: unknown): BuiltinColumn[] {
  if (!Array.isArray(raw)) return [];
  const out: BuiltinColumn[] = [];
  for (const item of raw) {
    if (isBuiltinColumn(item) && !out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * A usable layout from anything stored: known columns keep their stored order,
 * missing ones are appended in default order; unknown or duplicate entries and
 * a hidden message column are dropped.
 */
export function normalizeLayout(raw: unknown): BuiltinColumnLayout {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const order = knownUnique(source.order);
  for (const col of BUILTIN_COLUMNS) {
    if (!order.includes(col)) order.push(col);
  }
  const hidden = knownUnique(source.hidden).filter((c) => c !== ALWAYS_VISIBLE);
  return { order, hidden };
}

export function visibleColumns(layout: BuiltinColumnLayout): BuiltinColumn[] {
  return layout.order.filter((c) => !layout.hidden.includes(c));
}

/** Swap `col` with its neighbour; a move past either edge returns the layout unchanged. */
export function moveColumn(layout: BuiltinColumnLayout, col: BuiltinColumn, delta: -1 | 1): BuiltinColumnLayout {
  const index = layout.order.indexOf(col);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= layout.order.length) return layout;
  const order = [...layout.order];
  [order[index], order[target]] = [order[target], order[index]];
  return { order, hidden: [...layout.hidden] };
}

/** Show or hide `col`; the message column always stays visible. */
export function toggleColumn(layout: BuiltinColumnLayout, col: BuiltinColumn): BuiltinColumnLayout {
  if (col === ALWAYS_VISIBLE) return layout;
  const hidden = layout.hidden.includes(col) ? layout.hidden.filter((c) => c !== col) : [...layout.hidden, col];
  return { order: [...layout.order], hidden };
}

const storageKey = (projectKey: string) => `logtide:builtin-columns:${projectKey}`;

function readLayout(projectKey: string): BuiltinColumnLayout {
  if (!browser) return normalizeLayout(null);
  try {
    const raw = localStorage.getItem(storageKey(projectKey));
    return normalizeLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeLayout(null);
  }
}

function writeLayout(projectKey: string, layout: BuiltinColumnLayout): void {
  if (!browser) return;
  try {
    localStorage.setItem(storageKey(projectKey), JSON.stringify(layout));
  } catch {
    // blocked or full storage: the in-memory value stays authoritative
  }
}

/** Per-project layout persisted under `logtide:builtin-columns:<projectKey>`. */
export function createBuiltinColumnsStore(projectKey: string): Writable<BuiltinColumnLayout> {
  const store = writable<BuiltinColumnLayout>(readLayout(projectKey));
  return {
    subscribe: store.subscribe,
    set(value) {
      const next = normalizeLayout(value);
      writeLayout(projectKey, next);
      store.set(next);
    },
    update(updater) {
      store.update((current) => {
        const next = normalizeLayout(updater(current));
        writeLayout(projectKey, next);
        return next;
      });
    },
  };
}
