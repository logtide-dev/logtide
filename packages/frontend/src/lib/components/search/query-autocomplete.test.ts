import { describe, it, expect } from 'vitest';
import { parseLogQuery } from '@logtide/shared';
import { applySuggestion, getCompletionContext, suggest, type CompletionContext } from './query-autocomplete';

type Active = Exclude<CompletionContext, { kind: 'none' }>;

function active(input: string, caret = input.length): Active {
  const ctx = getCompletionContext(input, caret);
  if (ctx.kind === 'none') throw new Error(`no context for ${input}`);
  return ctx;
}

const noSources = { fields: [] as string[], valuesFor: () => [] as string[] };

describe('getCompletionContext', () => {
  it('field context for a partial key', () =>
    expect(getCompletionContext('timeout se', 10)).toEqual({ kind: 'field', prefix: 'se', start: 8, end: 10 }));

  it('skips a leading minus', () =>
    expect(getCompletionContext('-lev', 4)).toEqual({ kind: 'field', prefix: 'lev', start: 1, end: 4 }));

  it('value context after key colon', () =>
    expect(getCompletionContext('level:er', 8)).toEqual({
      kind: 'value',
      key: 'level',
      prefix: 'er',
      start: 6,
      end: 8,
      inList: false,
    }));

  it('value context for a negated key', () =>
    expect(getCompletionContext('timeout -service:ap', 19)).toEqual({
      kind: 'value',
      key: 'service',
      prefix: 'ap',
      start: 17,
      end: 19,
      inList: false,
    }));

  it('value context with an empty prefix right after the colon', () =>
    expect(getCompletionContext('level:', 6)).toEqual({
      kind: 'value',
      key: 'level',
      prefix: '',
      start: 6,
      end: 6,
      inList: false,
    }));

  it('value context inside an in-list', () =>
    expect(getCompletionContext('level:(error OR cr', 18)).toEqual({
      kind: 'value',
      key: 'level',
      prefix: 'cr',
      start: 16,
      end: 18,
      inList: true,
    }));

  it('value context at the start of an in-list', () =>
    expect(getCompletionContext('-level:(', 8)).toEqual({
      kind: 'value',
      key: 'level',
      prefix: '',
      start: 8,
      end: 8,
      inList: true,
    }));

  it('no context inside a list before OR', () => expect(getCompletionContext('level:(error O', 14)).toEqual({ kind: 'none' }));

  it('no context inside a phrase or for an empty token', () => {
    expect(getCompletionContext('"connection ref', 15)).toEqual({ kind: 'none' });
    expect(getCompletionContext('timeout ', 8)).toEqual({ kind: 'none' });
    expect(getCompletionContext('', 0)).toEqual({ kind: 'none' });
  });

  it('no context for text that only looks like a clause', () => {
    expect(getCompletionContext('at 10:42', 8)).toEqual({ kind: 'none' });
    expect(getCompletionContext('http://x', 8)).toEqual({ kind: 'none' });
    expect(getCompletionContext('service:"a b"', 13)).toEqual({ kind: 'none' });
    expect(getCompletionContext('ünï', 3)).toEqual({ kind: 'none' });
  });

  it('value context inside an opening quote of a value', () =>
    expect(getCompletionContext('service:"my se', 14)).toEqual({
      kind: 'value',
      key: 'service',
      prefix: 'my se',
      start: 8,
      end: 14,
      inList: false,
    }));

  it('extends the end to the rest of the token under the caret', () => {
    expect(getCompletionContext('serv timeout', 2)).toEqual({ kind: 'field', prefix: 'se', start: 0, end: 4 });
    expect(getCompletionContext('lev:error', 2)).toEqual({ kind: 'field', prefix: 'le', start: 0, end: 3 });
  });
});

describe('suggest', () => {
  it('suggests built-ins first, then discovered keys', () =>
    expect(
      suggest(active('se'), { fields: ['session.user', 'service.version'], valuesFor: () => [] }).map((s) => s.label),
    ).toEqual(['service', 'session', 'session.user', 'service.version']));

  it('dedupes discovered keys, skips unqueryable ones and inserts a colon', () => {
    const out = suggest(active('s'), { fields: ['service', 'sdk name', 'sdk.name', 'sdk.name'], valuesFor: () => [] });
    expect(out.map((s) => s.label)).toEqual(['service', 'session', 'span', 'sdk.name']);
    expect(out[0]).toEqual({ kind: 'field', label: 'service', insert: 'service:' });
  });

  it('matches case-insensitively and honours the limit', () => {
    const fields = Array.from({ length: 20 }, (_, i) => `Svc${i}`);
    expect(suggest(active('SE'), noSources).map((s) => s.label)).toEqual(['service', 'session']);
    expect(suggest(active('svc'), { fields, valuesFor: () => [] })).toHaveLength(8);
    expect(suggest(active('svc'), { fields, valuesFor: () => [] }, 3)).toHaveLength(3);
  });

  it('suggests levels for the level key', () =>
    expect(suggest(active('level:c'), noSources).map((s) => s.label)).toEqual(['critical']));

  it('asks valuesFor with the canonical key and quotes values', () => {
    const asked: string[] = [];
    const out = suggest(active('hostname:'), {
      fields: [],
      valuesFor: (k) => {
        asked.push(k);
        return ['web 1', 'web-2'];
      },
    });
    expect(asked).toEqual(['host']);
    expect(out).toEqual([
      { kind: 'value', label: 'web 1', insert: '"web 1"' },
      { kind: 'value', label: 'web-2', insert: 'web-2' },
    ]);
  });

  it('quotes OR inside an in-list', () => {
    const out = suggest(active('k:(a OR '), { fields: [], valuesFor: () => ['OR'] });
    expect(out[0].insert).toBe('"OR"');
  });

  it('returns nothing without a context', () => expect(suggest({ kind: 'none' }, noSources)).toEqual([]));
});

describe('applySuggestion', () => {
  it('applies a field suggestion', () =>
    expect(applySuggestion('lev', active('lev'), { kind: 'field', label: 'level', insert: 'level:' })).toEqual({
      value: 'level:',
      caret: 6,
    }));

  it('applies a quoted value suggestion', () =>
    expect(
      applySuggestion('service:my', active('service:my'), { kind: 'value', label: 'my service', insert: '"my service"' }),
    ).toEqual({ value: 'service:"my service" ', caret: 21 }));

  it('applies inside an in-list without a trailing space', () =>
    expect(
      applySuggestion('level:(error OR cr', active('level:(error OR cr'), {
        kind: 'value',
        label: 'critical',
        insert: 'critical',
      }),
    ).toEqual({ value: 'level:(error OR critical', caret: 24 }));

  it('keeps the text after the token and reuses a following space', () =>
    expect(
      applySuggestion('service:a timeout', active('service:a timeout', 9), { kind: 'value', label: 'api', insert: 'api' }),
    ).toEqual({ value: 'service:api timeout', caret: 12 }));

  it('replaces an opened quote with the quoted value', () => {
    const r = applySuggestion('service:"my', active('service:"my'), {
      kind: 'value',
      label: 'my service',
      insert: '"my service"',
    });
    expect(r).toEqual({ value: 'service:"my service" ', caret: 21 });
    const parsed = parseLogQuery(r.value);
    expect(parsed.ok && parsed.query.fields).toEqual([{ field: { builtin: 'service' }, op: 'equals', value: 'my service' }]);
  });
});
