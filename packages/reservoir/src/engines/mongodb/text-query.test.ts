import { describe, it, expect } from 'vitest';
import { compileTextQuery, escapeRegex, resolveTextQuery } from './text-query.js';
import { MongoDBQueryTranslator } from './query-translator.js';
import type { TextQuery } from '../../core/types.js';

const w = (value: string) => ({ kind: 'word' as const, value });
const p = (value: string) => ({ kind: 'phrase' as const, value });
const tq = (all: TextQuery['all'], anyOf: TextQuery['anyOf'] = [], none: TextQuery['none'] = []): TextQuery => ({ all, anyOf, none });

const BOUNDARY = '[^\\p{L}\\p{N}_]';
const word = (token: string) => ({ message: { $regex: `(?:^|${BOUNDARY})${token}(?:$|${BOUNDARY})`, $options: 'i' } });

const base = {
  projectId: '00000000-0000-0000-0000-000000000001',
  from: new Date('2026-01-01T00:00:00Z'),
  to: new Date('2026-01-02T00:00:00Z'),
};

type Filter = Record<string, unknown>;

describe('compileTextQuery', () => {
  it('word compiles to a boundary regex, never $text', () => {
    const clauses = compileTextQuery(tq([w('timeout')]));
    expect(clauses).toEqual([word('timeout')]);
    expect((clauses[0].message as { $regex: string }).$regex).toBe('(?:^|[^\\p{L}\\p{N}_])timeout(?:$|[^\\p{L}\\p{N}_])');
    expect(JSON.stringify(clauses)).not.toContain('$text');
  });

  it('word tokens are matched in lowercase with the i option', () => {
    expect(compileTextQuery(tq([w('TimeOut')]))).toEqual([word('timeout')]);
  });

  it('phrase escapes metacharacters', () => {
    expect(compileTextQuery(tq([p('c++ (beta)')]))).toEqual([{ message: { $regex: 'c\\+\\+ \\(beta\\)', $options: 'i' } }]);
    expect(compileTextQuery(tq([p('50%_off')]))).toEqual([{ message: { $regex: '50%_off', $options: 'i' } }]);
    expect(compileTextQuery(tq([p('C:\\temp')]))).toEqual([{ message: { $regex: 'C:\\\\temp', $options: 'i' } }]);
    expect(escapeRegex('a.b*c?d^e$f{g}h|i[j]k\\l')).toBe('a\\.b\\*c\\?d\\^e\\$f\\{g\\}h\\|i\\[j\\]k\\\\l');
  });

  it('multi-token word value ANDs each token', () => {
    expect(compileTextQuery(tq([w('foo-bar')]))).toEqual([{ $and: [word('foo'), word('bar')] }]);
  });

  it('a word without word characters is matched as a phrase', () => {
    expect(compileTextQuery(tq([w('--')]))).toEqual([{ message: { $regex: '--', $options: 'i' } }]);
  });

  it('anyOf becomes $or inside $and', () => {
    const clauses = compileTextQuery(tq([w('db')], [[w('timeout'), p('refused by')]]));
    expect(clauses).toEqual([word('db'), { $or: [word('timeout'), { message: { $regex: 'refused by', $options: 'i' } }] }]);
  });

  it('a single-term group is the term itself', () => {
    expect(compileTextQuery(tq([], [[w('timeout')]]))).toEqual([word('timeout')]);
  });

  it('none becomes $nor', () => {
    expect(compileTextQuery(tq([w('payment')], [], [w('failed'), p('card')]))).toEqual([
      word('payment'),
      { $nor: [word('failed'), { message: { $regex: 'card', $options: 'i' } }] },
    ]);
  });

  it('empty text query and blank terms add nothing', () => {
    expect(compileTextQuery(tq([]))).toEqual([]);
    expect(compileTextQuery(tq([p('   ')], [[w(' ')]], [p('')]))).toEqual([]);
  });
});

describe('resolveTextQuery', () => {
  it('substring search is one phrase', () => {
    expect(resolveTextQuery({ search: 'connection refused', searchMode: 'substring' })).toEqual(tq([p('connection refused')]));
  });

  it('fulltext search is the AND of its words', () => {
    expect(resolveTextQuery({ search: 'error message' })).toEqual(tq([w('error'), w('message')]));
    expect(resolveTextQuery({ search: 'error message', searchMode: 'fulltext' })).toEqual(tq([w('error'), w('message')]));
  });

  it('textQuery wins over search', () => {
    const text = tq([w('timeout')]);
    expect(resolveTextQuery({ textQuery: text, search: 'ignored', searchMode: 'substring' })).toBe(text);
  });

  it('no text gives undefined', () => {
    expect(resolveTextQuery({})).toBeUndefined();
    expect(resolveTextQuery({ search: '   ' })).toBeUndefined();
  });
});

describe('log filter text clauses', () => {
  const translator = new MongoDBQueryTranslator();

  it('cursor $or and an OR group coexist', () => {
    const cursorTime = new Date('2026-01-01T12:00:00Z');
    const cursor = Buffer.from(`${cursorTime.toISOString()},id-7`).toString('base64');
    const filter = translator.translateQuery({ ...base, cursor, textQuery: tq([], [[w('timeout'), w('refused')]]) }).query as Filter;
    expect(filter.$or).toBeUndefined();
    const and = filter.$and as Filter[];
    expect(and).toHaveLength(2);
    expect(and[0]).toEqual({ $or: [{ time: { $lt: cursorTime } }, { time: cursorTime, id: { $lt: 'id-7' } }] });
    expect(and[1]).toEqual({ $or: [word('timeout'), word('refused')] });
  });

  it('legacy search never emits $text', () => {
    for (const searchMode of [undefined, 'fulltext', 'substring'] as const) {
      const filter = translator.translateQuery({ ...base, search: 'connection error', searchMode }).query;
      expect(JSON.stringify(filter)).not.toContain('$text');
    }
  });

  it('text clauses sit in $and next to metadata clauses', () => {
    const filter = translator.translateCount({
      ...base,
      textQuery: tq([w('timeout')]),
      metadataFilters: [{ key: 'env', op: 'exists', include_missing: false }],
    }).query as Filter;
    expect(filter.message).toBeUndefined();
    const and = filter.$and as Filter[];
    expect(and[0]).toEqual(word('timeout'));
    expect(and).toHaveLength(2);
  });
});
