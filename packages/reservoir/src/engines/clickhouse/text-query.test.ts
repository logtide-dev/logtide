import { describe, it, expect } from 'vitest';
import {
  compileTextQuery,
  escapeLike,
  escapeRe2,
  lowerLikeClickHouse,
  resolveTextQuery,
  wordLikePattern,
} from './text-query.js';
import type { TextQuery } from '../../core/types.js';

const BOUNDARY = '[^\\p{L}\\p{N}_]';
const wordRe = (token: string) => `(?i)(^|${BOUNDARY})${token}($|${BOUNDARY})`;

function compile(text: Partial<TextQuery>) {
  const queryParams: Record<string, unknown> = {};
  const conditions = compileTextQuery({ all: [], anyOf: [], none: [], ...text }, queryParams);
  return { conditions, queryParams };
}

describe('clickhouse text query', () => {
  it('word uses a LIKE prefilter and a boundary regex', () => {
    const r = compile({ all: [{ kind: 'word', value: 'timeout' }] });
    expect(r.conditions).toEqual(['(lowerUTF8(message) LIKE {p_tq0:String} AND match(message, {p_tq1:String}))']);
    expect(r.queryParams).toEqual({ p_tq0: '%timeout%', p_tq1: '(?i)(^|[^\\p{L}\\p{N}_])timeout($|[^\\p{L}\\p{N}_])' });
  });

  it('the boundary pattern reaches the server with single backslashes', () => {
    const r = compile({ all: [{ kind: 'word', value: 'down' }] });
    const regex = r.queryParams.p_tq1 as string;
    expect(regex.split('\\').length - 1).toBe(4);
    expect(regex).toBe(wordRe('down'));
  });

  it('a word prefilter is lowercase', () => {
    const r = compile({ all: [{ kind: 'word', value: 'TIMEOUT' }] });
    expect(r.queryParams.p_tq0).toBe('%timeout%');
  });

  it('phrase escapes metacharacters', () => {
    const r = compile({ all: [{ kind: 'phrase', value: '50%_off' }] });
    expect(r.conditions).toEqual(['lowerUTF8(message) LIKE {p_tq0:String}']);
    expect(r.queryParams.p_tq0).toBe('%50\\%\\_off%');
    const beta = compile({ all: [{ kind: 'phrase', value: 'C++ (Beta)' }] });
    expect(beta.queryParams.p_tq0).toBe('%c++ (beta)%');
    const slash = compile({ all: [{ kind: 'phrase', value: 'a\\b' }] });
    expect(slash.queryParams.p_tq0).toBe('%a\\\\b%');
  });

  it('multi-token word ANDs each token', () => {
    const r = compile({ all: [{ kind: 'word', value: 'foo-bar' }] });
    expect(r.conditions).toHaveLength(1);
    expect(r.conditions[0]).toBe(
      '((lowerUTF8(message) LIKE {p_tq0:String} AND match(message, {p_tq1:String})) AND (lowerUTF8(message) LIKE {p_tq2:String} AND match(message, {p_tq3:String})))',
    );
    expect(r.queryParams.p_tq1).toBe(wordRe('foo'));
    expect(r.queryParams.p_tq3).toBe(wordRe('bar'));
  });

  it('a word without word characters is a phrase', () => {
    const r = compile({ all: [{ kind: 'word', value: '--' }] });
    expect(r.conditions).toEqual(['lowerUTF8(message) LIKE {p_tq0:String}']);
    expect(r.queryParams.p_tq0).toBe('%--%');
  });

  it('anyOf is one OR group', () => {
    const r = compile({ anyOf: [[{ kind: 'word', value: 'timeout' }, { kind: 'phrase', value: 'refused by' }]] });
    expect(r.conditions).toHaveLength(1);
    expect(r.conditions[0]).toBe(
      '((lowerUTF8(message) LIKE {p_tq0:String} AND match(message, {p_tq1:String})) OR lowerUTF8(message) LIKE {p_tq2:String})',
    );
  });

  it('none is wrapped in NOT', () => {
    const r = compile({ all: [{ kind: 'word', value: 'payment' }], none: [{ kind: 'phrase', value: 'failed' }] });
    expect(r.conditions).toHaveLength(2);
    expect(r.conditions[1]).toBe('NOT (lowerUTF8(message) LIKE {p_tq2:String})');
    expect(r.queryParams.p_tq2).toBe('%failed%');
  });

  it('empty text query adds no condition', () => {
    expect(compile({}).conditions).toEqual([]);
    expect(compile({ all: [{ kind: 'phrase', value: '   ' }], anyOf: [[{ kind: 'word', value: ' ' }]] }).conditions).toEqual([]);
  });

  it('parameter names never overwrite existing parameters', () => {
    const queryParams: Record<string, unknown> = { p_tq0: 'taken' };
    const conditions = compileTextQuery({ all: [{ kind: 'phrase', value: 'x' }], anyOf: [], none: [] }, queryParams);
    expect(conditions).toEqual(['lowerUTF8(message) LIKE {p_tq1:String}']);
    expect(queryParams.p_tq0).toBe('taken');
  });

  it('escapeLike and escapeRe2 escape every metacharacter', () => {
    expect(escapeLike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
    expect(escapeRe2('\\^$.|?*+()[]{}')).toBe('\\\\\\^\\$\\.\\|\\?\\*\\+\\(\\)\\[\\]\\{\\}');
  });

  it('lowercases one code point at a time like lowerUTF8', () => {
    expect(lowerLikeClickHouse('ÜBERWEISUNG ÉCHOUÉ ОШИБКА')).toBe('überweisung échoué ошибка');
    // Capital sigma at the end of a word: lowerUTF8 gives the medial form.
    expect(lowerLikeClickHouse('ΟΔΟΣ')).toBe('οδοσ');
    // Dotted capital I lowercases to two code points: lowerUTF8 keeps it.
    expect(lowerLikeClickHouse('İ')).toBe('İ');
  });

  it('a word prefilter accepts both sigma forms', () => {
    expect(wordLikePattern('οδος')).toBe('%οδο_%');
  });

  describe('resolveTextQuery', () => {
    it('substring search is one phrase', () => {
      expect(resolveTextQuery({ search: 'connection refused', searchMode: 'substring' })).toEqual({
        all: [{ kind: 'phrase', value: 'connection refused' }],
        anyOf: [],
        none: [],
      });
    });

    it('fulltext search is the AND of its words', () => {
      expect(resolveTextQuery({ search: 'error message' })).toEqual({
        all: [{ kind: 'word', value: 'error' }, { kind: 'word', value: 'message' }],
        anyOf: [],
        none: [],
      });
      expect(resolveTextQuery({ search: 'error message', searchMode: 'fulltext' })?.all).toHaveLength(2);
    });

    it('textQuery wins over search', () => {
      const textQuery: TextQuery = { all: [{ kind: 'word', value: 'x' }], anyOf: [], none: [] };
      expect(resolveTextQuery({ textQuery, search: 'other' })).toBe(textQuery);
    });

    it('nothing to match gives undefined', () => {
      expect(resolveTextQuery({})).toBeUndefined();
      expect(resolveTextQuery({ search: '   ' })).toBeUndefined();
    });
  });
});
