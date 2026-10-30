import { describe, it, expect } from 'vitest';
import {
  parseErrorsListState,
  writeErrorsListState,
  DEFAULT_ERRORS_LIST_STATE,
} from './errors-url-state';

const u = (qs = '') => new URL(`http://localhost/dashboard/errors${qs}`);

describe('errors url state', () => {
  it('defaults when the URL is empty', () => {
    expect(parseErrorsListState(u())).toEqual({
      status: 'open',
      sort: 'last_seen',
      language: '',
      search: '',
      assignee: '',
      service: '',
      page: 1,
    });
  });

  it('status=all round-trips', () => {
    const state = parseErrorsListState(u('?status=all'));
    expect(state.status).toBe('all');
    const written = writeErrorsListState(u(), state);
    expect(written.searchParams.get('status')).toBe('all');
    expect(parseErrorsListState(written).status).toBe('all');
  });

  it('parses every field', () => {
    const state = parseErrorsListState(
      u('?status=resolved&sort=events&language=python&search=timeout&assignee=me&service=api&page=3')
    );
    expect(state).toEqual({
      status: 'resolved',
      sort: 'events',
      language: 'python',
      search: 'timeout',
      assignee: 'me',
      service: 'api',
      page: 3,
    });
  });

  it('invalid sort, language, status, assignee and page fall back', () => {
    const state = parseErrorsListState(
      u('?status=bogus&sort=bogus&language=cobol&assignee=nobody&page=-2')
    );
    expect(state).toEqual(DEFAULT_ERRORS_LIST_STATE);
    expect(parseErrorsListState(u('?page=abc')).page).toBe(1);
    expect(parseErrorsListState(u('?page=2.5')).page).toBe(1);
    expect(parseErrorsListState(u('?page=0')).page).toBe(1);
  });

  it('write omits defaults', () => {
    const written = writeErrorsListState(u('?status=all&page=4'), DEFAULT_ERRORS_LIST_STATE);
    expect(written.search).toBe('');
  });

  it('write keeps unrelated params (project, range) untouched', () => {
    const written = writeErrorsListState(
      u('?project=p1,p2&range=24h&from=2026-01-01&status=resolved'),
      { ...DEFAULT_ERRORS_LIST_STATE, sort: 'events', page: 2 }
    );
    expect(written.searchParams.get('project')).toBe('p1,p2');
    expect(written.searchParams.get('range')).toBe('24h');
    expect(written.searchParams.get('from')).toBe('2026-01-01');
    expect(written.searchParams.get('sort')).toBe('events');
    expect(written.searchParams.get('page')).toBe('2');
    expect(written.searchParams.has('status')).toBe(false);
  });

  it('does not mutate the input URL', () => {
    const input = u('?status=all');
    writeErrorsListState(input, DEFAULT_ERRORS_LIST_STATE);
    expect(input.searchParams.get('status')).toBe('all');
  });

  it('service round-trips and is omitted when empty', () => {
    const withService = writeErrorsListState(u(), { ...DEFAULT_ERRORS_LIST_STATE, service: 'checkout api' });
    expect(withService.searchParams.get('service')).toBe('checkout api');
    expect(parseErrorsListState(withService).service).toBe('checkout api');

    const without = writeErrorsListState(withService, { ...DEFAULT_ERRORS_LIST_STATE, service: '' });
    expect(without.searchParams.has('service')).toBe(false);
  });
});
