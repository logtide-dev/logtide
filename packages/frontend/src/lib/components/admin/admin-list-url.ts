import type { DataTableSort } from '$lib/components/app/data-table';

/** Positive integer from a query value, else the fallback. */
export function parsePage(value: string | null | undefined, fallback = 1): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

/** One of the allowed values, else the fallback. */
export function parseEnum<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Sort from `sort` + `order` query values, restricted to the sortable keys. */
export function parseSort(
  params: URLSearchParams,
  allowed: readonly string[],
  fallback: DataTableSort,
): DataTableSort {
  const key = params.get('sort');
  if (!key || !allowed.includes(key)) return fallback;
  return { key, dir: params.get('order') === 'asc' ? 'asc' : 'desc' };
}

/** True when two sorts are the same key and direction. */
export function sameSort(a: DataTableSort | undefined, b: DataTableSort): boolean {
  return !!a && a.key === b.key && a.dir === b.dir;
}

export interface ListUrlState {
  q: string;
  page: number;
  sort: DataTableSort | undefined;
  defaultSort: DataTableSort;
  /** Filter values by query name; empty or default values are left out. */
  filters: Record<string, string>;
  /** Filter values that mean "no filter" and so stay out of the URL. */
  filterDefaults?: Record<string, string>;
}

/** Query string for the list URL. Defaults are omitted so the bare URL stays clean. */
export function buildListSearch(state: ListUrlState): string {
  const params = new URLSearchParams();
  const q = state.q.trim();
  if (q) params.set('q', q);
  for (const [key, value] of Object.entries(state.filters)) {
    if (value && value !== (state.filterDefaults?.[key] ?? '')) params.set(key, value);
  }
  if (state.sort && !sameSort(state.sort, state.defaultSort)) {
    params.set('sort', state.sort.key);
    params.set('order', state.sort.dir);
  }
  if (state.page > 1) params.set('page', String(state.page));
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Random password with letters, digits and symbols, for the create-user helper. */
export function generatePassword(length = 16): string {
  const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%^&*-_=+'];
  const all = sets.join('');
  const pick = (chars: string) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return chars[buf[0] % chars.length];
  };
  const out = sets.map(pick);
  while (out.length < Math.max(length, sets.length)) out.push(pick(all));
  // Fisher-Yates so the guaranteed characters are not always first.
  for (let i = out.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}
