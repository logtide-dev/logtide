import { describe, it, expect } from 'vitest';
import { MongoDBQueryTranslator } from './query-translator.js';
import { resolvedValueExpr, scalarTextExpr } from './json-path.js';
import type { MetadataFilter } from '../../core/types.js';

const translator = new MongoDBQueryTranslator();

const baseParams = {
  projectId: '00000000-0000-0000-0000-000000000001',
  from: new Date('2026-01-01T00:00:00Z'),
  to: new Date('2026-01-02T00:00:00Z'),
};

/** Build a fully-typed MetadataFilter with include_missing defaulting to false */
function mf(o: Omit<MetadataFilter, 'include_missing'> & { include_missing?: boolean }): MetadataFilter {
  return { include_missing: false, ...o } as MetadataFilter;
}

/** The compound clauses of the filter (only metadata clauses in these tests). */
function metaClauses(r: { query: Record<string, unknown> }): Record<string, unknown>[] {
  return (r.query.$and as Record<string, unknown>[] | undefined) ?? [];
}

/** The positive native clause: text candidates, arrays excluded. */
const has = (key: string, candidates: unknown[]) => ({ [`metadata.${key}`]: { $in: candidates, $not: { $type: 'array' } } });

describe('MongoDBQueryTranslator metadata filters', () => {
  it('no filters adds no $and metadata clauses', () => {
    const r = translator.translateQuery(baseParams);
    expect(metaClauses(r as never)).toHaveLength(0);
  });

  it('equals matches the text candidates', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'equals', value: 'prod' })],
    });
    expect(metaClauses(r as never)).toContainEqual(has('env', ['prod']));
  });

  it('not_equals with include_missing=true matches missing keys through $nor', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_equals', value: 'dev', include_missing: true })],
    });
    expect(metaClauses(r as never)).toContainEqual({ $nor: [has('env', ['dev'])] });
  });

  it('not_equals with include_missing=false requires key present', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_equals', value: 'dev', include_missing: false })],
    });
    expect(metaClauses(r as never)).toContainEqual({ 'metadata.env': { $exists: true }, $nor: [has('env', ['dev'])] });
  });

  it('in emits $in over the candidates', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'in', values: ['prod', 'staging'] })],
    });
    expect(metaClauses(r as never)).toContainEqual(has('env', ['prod', 'staging']));
  });

  it('not_in with include_missing=true matches missing keys through $nor', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_in', values: ['dev'], include_missing: true })],
    });
    expect(metaClauses(r as never)).toContainEqual({ $nor: [has('env', ['dev'])] });
  });

  it('not_in with include_missing=false requires key present', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_in', values: ['dev'], include_missing: false })],
    });
    expect(metaClauses(r as never)).toContainEqual({ 'metadata.env': { $exists: true }, $nor: [has('env', ['dev'])] });
  });

  it('exists emits $exists true', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'exists' })],
    });
    expect(metaClauses(r as never)).toContainEqual({ 'metadata.env': { $exists: true } });
  });

  it('not_exists emits $exists false', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_exists' })],
    });
    expect(metaClauses(r as never)).toContainEqual({ 'metadata.env': { $exists: false } });
  });

  it('contains emits a case-insensitive $regexMatch over the text form with an escaped value', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'msg', op: 'contains', value: 'a.b' })],
    });
    expect(metaClauses(r as never)).toContainEqual({
      $expr: { $regexMatch: { input: scalarTextExpr(resolvedValueExpr('metadata', 'msg')), regex: 'a\\.b', options: 'i' } },
    });
  });

  it('combines multiple filters as separate $and clauses', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [
        mf({ key: 'env', op: 'equals', value: 'prod' }),
        mf({ key: 'region', op: 'in', values: ['us', 'eu'] }),
      ],
    });
    const clauses = metaClauses(r as never);
    expect(clauses).toContainEqual(has('env', ['prod']));
    expect(clauses).toContainEqual(has('region', ['us', 'eu']));
  });

  it('repeated filters on one key are all kept', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [
        mf({ key: 'env', op: 'exists' }),
        mf({ key: 'env', op: 'not_equals', value: 'dev', include_missing: true }),
      ],
    });
    expect(metaClauses(r as never)).toEqual([{ 'metadata.env': { $exists: true } }, { $nor: [has('env', ['dev'])] }]);
  });

  it('applies metadata filters in translateCount as well', () => {
    const r = translator.translateCount({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'equals', value: 'prod' })],
    });
    expect(metaClauses(r as never)).toContainEqual(has('env', ['prod']));
  });
});
