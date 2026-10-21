import { describe, it, expect } from 'vitest';
import { compileTextQuery, escapeIlike, escapePgRegex, resolveTextQuery } from './text-query.js';
import type { TextQuery } from '../../core/types.js';

const word = (value: string) => ({ kind: 'word' as const, value });
const phrase = (value: string) => ({ kind: 'phrase' as const, value });
const q = (all: TextQuery['all'], anyOf: TextQuery['anyOf'] = [], none: TextQuery['none'] = []): TextQuery => ({ all, anyOf, none });

const FTS = "to_tsvector('english', message) @@ plainto_tsquery('english', $";

describe('compileTextQuery', () => {
  it('word emits a word-boundary regex or the full-text index', () => {
    const r = compileTextQuery(q([word('timeout')]), 1);
    expect(r.conditions).toEqual([
      "(message ~* $1 OR (to_tsvector('english', message) @@ plainto_tsquery('english', $2) AND strpos(message, '_') = 0))",
    ]);
    expect(r.values).toEqual(['\\mtimeout\\M', 'timeout']);
    expect(r.nextIdx).toBe(3);
  });

  it('starts binding at the given index', () => {
    const r = compileTextQuery(q([word('timeout')]), 7);
    expect(r.conditions[0]).toContain('message ~* $7');
    expect(r.conditions[0]).toContain(`${FTS}8)`);
    expect(r.nextIdx).toBe(9);
  });

  it('matches words case-insensitively: the token is lowercased', () => {
    const r = compileTextQuery(q([word('TimeOut')]), 1);
    expect(r.values).toEqual(['\\mtimeout\\M', 'timeout']);
  });

  it('word with underscore uses only the regex branch', () => {
    const r = compileTextQuery(q([word('user_id')]), 1);
    expect(r.conditions).toEqual(['message ~* $1']);
    expect(r.values).toEqual(['\\muser_id\\M']);
  });

  it('non-ASCII words use only the regex branch', () => {
    for (const value of ['ошибка', 'échoué', '東京']) {
      const r = compileTextQuery(q([word(value)]), 1);
      expect(r.conditions, value).toEqual(['message ~* $1']);
      expect(r.values, value).toEqual([`\\m${value}\\M`]);
    }
  });

  it('phrase escapes metacharacters', () => {
    expect(compileTextQuery(q([phrase('50%_off')]), 1)).toEqual({
      conditions: ['message ILIKE $1'],
      values: ['%50\\%\\_off%'],
      nextIdx: 2,
    });
    expect(compileTextQuery(q([phrase('c++ (beta)')]), 1).values).toEqual(['%c++ (beta)%']);
    expect(compileTextQuery(q([phrase('C:\\temp')]), 1).values).toEqual(['%C:\\\\temp%']);
  });

  it('multi-token word value ANDs each token', () => {
    const r = compileTextQuery(q([word('foo-bar')]), 1);
    expect(r.conditions).toHaveLength(2);
    expect(r.values).toEqual(['\\mfoo\\M', 'foo', '\\mbar\\M', 'bar']);
  });

  it('a word without tokens is a phrase of its value', () => {
    const r = compileTextQuery(q([word('--')]), 1);
    expect(r.conditions).toEqual(['message ILIKE $1']);
    expect(r.values).toEqual(['%--%']);
  });

  it('anyOf group is one parenthesized OR', () => {
    const r = compileTextQuery(q([], [[word('timeout'), phrase('refused by')]]), 1);
    expect(r.conditions).toHaveLength(1);
    expect(r.conditions[0].startsWith('(')).toBe(true);
    expect(r.conditions[0].endsWith(')')).toBe(true);
    expect(r.conditions[0]).toContain(' OR message ILIKE $3');
    expect(r.values).toEqual(['\\mtimeout\\M', 'timeout', '%refused by%']);
  });

  it('a multi-token word inside a group stays one AND', () => {
    const r = compileTextQuery(q([], [[word('foo-bar'), word('baz')]]), 1);
    expect(r.conditions).toHaveLength(1);
    expect(r.conditions[0]).toMatch(/^\(\(.* AND .*\) OR /);
  });

  it('none is wrapped in NOT', () => {
    const r = compileTextQuery(q([], [], [word('timeout'), phrase('db')]), 1);
    expect(r.conditions).toHaveLength(2);
    expect(r.conditions[0].startsWith('NOT (')).toBe(true);
    expect(r.conditions[1]).toBe('NOT (message ILIKE $3)');
  });

  it('empty text query adds no condition', () => {
    expect(compileTextQuery(q([]), 4)).toEqual({ conditions: [], values: [], nextIdx: 4 });
  });

  it('blank terms and groups of blank terms are ignored', () => {
    expect(compileTextQuery(q([phrase('  ')], [[phrase(' ')]], [word('')]), 1)).toEqual({ conditions: [], values: [], nextIdx: 1 });
  });

  it('never inlines user text into the SQL', () => {
    const r = compileTextQuery(q([phrase("'; DROP TABLE logs; --")], [], [word('x')]), 1);
    expect(r.conditions.join(' ')).not.toContain('DROP');
  });
});

describe('escapePgRegex', () => {
  it('escapes every ARE metacharacter', () => {
    expect(escapePgRegex('a\\^$.|?*+()[]{}b')).toBe('a\\\\\\^\\$\\.\\|\\?\\*\\+\\(\\)\\[\\]\\{\\}b');
  });
});

describe('escapeIlike', () => {
  it('escapes backslash, percent and underscore', () => {
    expect(escapeIlike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
  });
});

describe('resolveTextQuery', () => {
  it('substring search is one phrase', () => {
    expect(resolveTextQuery({ search: 'connection refused', searchMode: 'substring' })).toEqual(q([phrase('connection refused')]));
  });

  it('fulltext search is the AND of its words', () => {
    expect(resolveTextQuery({ search: 'error message' })).toEqual(q([word('error'), word('message')]));
    expect(resolveTextQuery({ search: 'error message', searchMode: 'fulltext' })).toEqual(q([word('error'), word('message')]));
  });

  it('textQuery wins over search', () => {
    const textQuery = q([word('timeout')]);
    expect(resolveTextQuery({ textQuery, search: 'redis', searchMode: 'substring' })).toBe(textQuery);
  });

  it('nothing to search gives undefined', () => {
    expect(resolveTextQuery({})).toBeUndefined();
    expect(resolveTextQuery({ search: '   ' })).toBeUndefined();
  });
});
