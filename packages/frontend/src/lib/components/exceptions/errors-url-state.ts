import {
  ERROR_GROUP_SORTS,
  ERROR_GROUP_STATUSES,
  EXCEPTION_LANGUAGES,
  type ErrorGroupSort,
  type ErrorGroupStatus,
  type ExceptionLanguage,
} from '@logtide/shared';

/**
 * Errors list state kept in the URL. Scope params (project, range, from, to)
 * belong to the scope store and are never read or written here.
 */
export type ErrorsListState = {
  status: ErrorGroupStatus | 'all';
  sort: ErrorGroupSort;
  language: ExceptionLanguage | '';
  search: string;
  assignee: '' | 'me' | 'unassigned';
  service: string;
  page: number;
};

export const DEFAULT_ERRORS_LIST_STATE: ErrorsListState = {
  status: 'open',
  sort: 'last_seen',
  language: '',
  search: '',
  assignee: '',
  service: '',
  page: 1,
};

const OWNED_PARAMS = ['status', 'sort', 'language', 'search', 'assignee', 'service', 'page'] as const;

export function parseErrorsListState(url: URL): ErrorsListState {
  const p = url.searchParams;

  const rawStatus = p.get('status');
  const status: ErrorsListState['status'] =
    rawStatus === 'all'
      ? 'all'
      : (ERROR_GROUP_STATUSES as readonly string[]).includes(rawStatus ?? '')
        ? (rawStatus as ErrorGroupStatus)
        : DEFAULT_ERRORS_LIST_STATE.status;

  const rawSort = p.get('sort');
  const sort: ErrorGroupSort = (ERROR_GROUP_SORTS as readonly string[]).includes(rawSort ?? '')
    ? (rawSort as ErrorGroupSort)
    : DEFAULT_ERRORS_LIST_STATE.sort;

  const rawLanguage = p.get('language');
  const language: ExceptionLanguage | '' = (EXCEPTION_LANGUAGES as readonly string[]).includes(rawLanguage ?? '')
    ? (rawLanguage as ExceptionLanguage)
    : '';

  const rawAssignee = p.get('assignee');
  const assignee: ErrorsListState['assignee'] =
    rawAssignee === 'me' || rawAssignee === 'unassigned' ? rawAssignee : '';

  const rawPage = Number(p.get('page'));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  return {
    status,
    sort,
    language,
    search: p.get('search') ?? '',
    assignee,
    service: p.get('service') ?? '',
    page,
  };
}

/** Returns a copy of the URL with the list state applied; defaults are omitted. */
export function writeErrorsListState(url: URL, state: ErrorsListState): URL {
  const next = new URL(url.toString());
  for (const key of OWNED_PARAMS) next.searchParams.delete(key);

  // Absent status means open, so "all" has to be written explicitly.
  if (state.status !== DEFAULT_ERRORS_LIST_STATE.status) next.searchParams.set('status', state.status);
  if (state.sort !== DEFAULT_ERRORS_LIST_STATE.sort) next.searchParams.set('sort', state.sort);
  if (state.language) next.searchParams.set('language', state.language);
  if (state.search) next.searchParams.set('search', state.search);
  if (state.assignee) next.searchParams.set('assignee', state.assignee);
  if (state.service) next.searchParams.set('service', state.service);
  if (state.page > 1) next.searchParams.set('page', String(state.page));
  return next;
}
