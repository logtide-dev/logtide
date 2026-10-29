import type { DataTableSort } from '$lib/components/app/data-table';
import type { OrganizationSort, SortOrder } from '$lib/api/admin';
import { buildListSearch, parsePage, parseSort } from './admin-list-url';

export const ORG_SORT_KEYS: readonly OrganizationSort[] = ['name', 'created_at', 'members', 'projects'];

export const DEFAULT_ORG_SORT: DataTableSort = { key: 'created_at', dir: 'desc' };

export interface OrgListParams {
  q: string;
  page: number;
  sort: DataTableSort;
}

/** Reads q, page, sort and order from a query string; unknown values fall back to the defaults. */
export function parseOrgListParams(params: URLSearchParams): OrgListParams {
  return {
    q: (params.get('q') ?? '').trim(),
    page: parsePage(params.get('page')),
    sort: parseSort(params, ORG_SORT_KEYS, DEFAULT_ORG_SORT),
  };
}

/** Maps the table sort to the API options. */
export function sortToApi(sort: DataTableSort | undefined): { sort: OrganizationSort; order: SortOrder } {
  const s = sort ?? DEFAULT_ORG_SORT;
  const key = (ORG_SORT_KEYS as readonly string[]).includes(s.key) ? (s.key as OrganizationSort) : 'created_at';
  return { sort: key, order: s.dir };
}

/** Query string for the URL; defaults are omitted so the plain list stays at the bare path. */
export function buildOrgListSearch(p: OrgListParams): string {
  return buildListSearch({
    q: p.q,
    page: p.page,
    sort: p.sort,
    defaultSort: DEFAULT_ORG_SORT,
    filters: {},
  });
}
