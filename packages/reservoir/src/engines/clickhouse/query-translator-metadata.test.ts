import { describe, it, expect } from 'vitest';
import { ClickHouseQueryTranslator } from './query-translator.js';
import type { MetadataFilter } from '../../core/types.js';

const translator = new ClickHouseQueryTranslator('logs');

const baseParams = {
  projectId: '00000000-0000-0000-0000-000000000001',
  from: new Date('2026-01-01T00:00:00Z'),
  to: new Date('2026-01-02T00:00:00Z'),
};

/** Build a fully-typed MetadataFilter with include_missing defaulting to false */
function mf(o: Omit<MetadataFilter, 'include_missing'> & { include_missing?: boolean }): MetadataFilter {
  return { include_missing: false, ...o } as MetadataFilter;
}

function paramsOf(r: { parameters: unknown[] }): Record<string, unknown> {
  return r.parameters[0] as Record<string, unknown>;
}

describe('ClickHouseQueryTranslator metadata filters', () => {
  it('no filters adds nothing', () => {
    const r = translator.translateQuery(baseParams);
    expect(r.query).not.toContain('JSONExtractRaw(metadata,');
    expect(r.query).not.toContain('JSONHas(metadata,');
  });

  it('equals compares the scalar text of the raw value', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'equals', value: 'prod' })],
    });
    expect(r.query).toContain('multiIf(JSONExtractRaw(metadata,');
    expect(Object.values(paramsOf(r))).toContain('env');
    expect(Object.values(paramsOf(r))).toContain('prod');
  });

  it('not_equals with include_missing=true allows missing key', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_equals', value: 'dev', include_missing: true })],
    });
    expect(r.query).toContain('(NOT (JSONHas(metadata,');
    expect(r.query).toContain('!=');
  });

  it('not_equals with include_missing=false requires key present', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_equals', value: 'dev', include_missing: false })],
    });
    expect(r.query).toContain('(JSONHas(metadata, {p_mfk0:String}) AND ');
    expect(r.query).not.toContain('NOT (JSONHas(');
    expect(r.query).toContain('!=');
  });

  it('in emits IN array', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'in', values: ['prod', 'staging'] })],
    });
    expect(r.query).toContain(' IN {p_mfv0:Array(String)}');
    expect(Object.values(paramsOf(r))).toContainEqual(['prod', 'staging']);
  });

  it('not_in with include_missing=true allows missing key', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_in', values: ['dev'], include_missing: true })],
    });
    expect(r.query).toContain('(NOT (JSONHas(metadata,');
    expect(r.query).toContain('NOT IN');
  });

  it('not_in with include_missing=false requires key present', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_in', values: ['dev'], include_missing: false })],
    });
    expect(r.query).toContain('(JSONHas(metadata, {p_mfk0:String}) AND ');
    expect(r.query).not.toContain('NOT (JSONHas(');
    expect(r.query).toContain('NOT IN');
  });

  it('exists emits JSONHas', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'exists' })],
    });
    expect(r.query).toContain('JSONHas(metadata, {p_mfk0:String})');
    expect(r.query).not.toContain('NOT (JSONHas(');
    expect(Object.values(paramsOf(r))).toContain('env');
  });

  it('not_exists negates JSONHas', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_exists' })],
    });
    expect(r.query).toContain('NOT (JSONHas(metadata, {p_mfk0:String}))');
    expect(Object.values(paramsOf(r))).toContain('env');
  });

  it('contains emits case-insensitive position match', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'msg', op: 'contains', value: 'foo' })],
    });
    expect(r.query).toContain('positionCaseInsensitiveUTF8(multiIf(JSONExtractRaw(metadata,');
    expect(Object.values(paramsOf(r))).toContain('foo');
  });

  it('combines multiple filters with AND', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [
        mf({ key: 'env', op: 'equals', value: 'prod' }),
        mf({ key: 'region', op: 'in', values: ['us', 'eu'] }),
      ],
    });
    const values = Object.values(paramsOf(r));
    expect(values).toContain('env');
    expect(values).toContain('prod');
    expect(values).toContain('region');
    expect(values).toContainEqual(['us', 'eu']);
  });

  it('applies metadata filters in translateCount as well', () => {
    const r = translator.translateCount({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'equals', value: 'prod' })],
    });
    expect(r.query).toContain('JSONExtractRaw(metadata,');
    expect(Object.values(paramsOf(r))).toContain('env');
  });
});
