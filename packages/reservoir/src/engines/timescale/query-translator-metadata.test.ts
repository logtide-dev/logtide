import { describe, it, expect } from 'vitest';
import { TimescaleQueryTranslator } from './query-translator.js';
import type { MetadataFilter } from '../../core/types.js';

const translator = new TimescaleQueryTranslator('public', 'logs');

const baseParams = {
  projectId: '00000000-0000-0000-0000-000000000001',
  from: new Date('2026-01-01T00:00:00Z'),
  to: new Date('2026-01-02T00:00:00Z'),
};

/** Build a fully-typed MetadataFilter with include_missing defaulting to false */
function mf(o: Omit<MetadataFilter, 'include_missing'> & { include_missing?: boolean }): MetadataFilter {
  return { include_missing: false, ...o } as MetadataFilter;
}

describe('TimescaleQueryTranslator metadata filters', () => {
  it('no filters adds nothing', () => {
    const r = translator.translateQuery(baseParams);
    expect(r.query).not.toContain('metadata->>$');
  });

  it('equals emits = predicate', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'equals', value: 'prod' })],
    });
    expect(r.query).toContain("CASE WHEN jsonb_typeof(metadata->$");
    expect(r.query).toContain(' = $');
    expect(r.parameters).toContain('env');
    expect(r.parameters).toContain('prod');
  });

  it('not_equals with include_missing=true emits IS DISTINCT FROM', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_equals', value: 'dev', include_missing: true })],
    });
    expect(r.query).toContain('IS DISTINCT FROM');
  });

  it('not_equals with include_missing=false requires key present', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_equals', value: 'dev', include_missing: false })],
    });
    expect(r.query).toMatch(/metadata \? \$\d+ AND CASE WHEN jsonb_typeof\(metadata->\$\d+\) IN \('string', 'number', 'boolean'\) THEN \(metadata->\$\d+\) #>> '\{\}' END IS DISTINCT FROM \$\d+/);
  });

  it('in emits = ANY', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'in', values: ['prod', 'staging'] })],
    });
    expect(r.query).toContain('= ANY(');
    expect(r.parameters).toContainEqual(['prod', 'staging']);
  });

  it('not_in with include_missing=true handles NULL', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_in', values: ['dev'], include_missing: true })],
    });
    expect(r.query).toMatch(/IS NULL OR CASE WHEN jsonb_typeof\(metadata->\$\d+\) IN \('string', 'number', 'boolean'\) THEN \(metadata->\$\d+\) #>> '\{\}' END <> ALL/);
  });

  it('not_in with include_missing=false requires key present', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_in', values: ['dev'], include_missing: false })],
    });
    expect(r.query).toMatch(/metadata \? \$\d+ AND \(CASE WHEN jsonb_typeof\(metadata->\$\d+\) IN \('string', 'number', 'boolean'\) THEN \(metadata->\$\d+\) #>> '\{\}' END IS NULL OR CASE WHEN jsonb_typeof\(metadata->\$\d+\) IN \('string', 'number', 'boolean'\) THEN \(metadata->\$\d+\) #>> '\{\}' END <> ALL/);
  });

  it('exists emits ? operator', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'exists' })],
    });
    expect(r.query).toMatch(/metadata \? \$\d+/);
    expect(r.parameters).toContain('env');
  });

  it('not_exists emits NOT (? )', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'not_exists' })],
    });
    expect(r.query).toMatch(/NOT \(metadata \? \$\d+\)/);
    expect(r.parameters).toContain('env');
  });

  it('contains emits ILIKE with wildcards', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'msg', op: 'contains', value: 'foo' })],
    });
    expect(r.query).toContain('ILIKE');
    expect(r.parameters).toContain('%foo%');
  });

  it('escapes ILIKE wildcards in contains', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'msg', op: 'contains', value: 'a%b_c' })],
    });
    expect(r.parameters).toContain('%a\\%b\\_c%');
  });

  it('combines multiple filters with AND', () => {
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [
        mf({ key: 'env', op: 'equals', value: 'prod' }),
        mf({ key: 'region', op: 'in', values: ['us', 'eu'] }),
      ],
    });
    expect(r.parameters).toContain('env');
    expect(r.parameters).toContain('prod');
    expect(r.parameters).toContain('region');
    expect(r.parameters).toContainEqual(['us', 'eu']);
    // Both predicates separated by AND
    const andCount = (r.query.match(/ AND /g) ?? []).length;
    // at least: project_id + from + to + 2 metadata = 4 ANDs minimum
    expect(andCount).toBeGreaterThanOrEqual(4);
  });

  it('metadata filter params follow base params in order', () => {
    // projectId=$1, from=$2, to=$3, then metadata key=$4, value=$5
    const r = translator.translateQuery({
      ...baseParams,
      metadataFilters: [mf({ key: 'env', op: 'equals', value: 'prod' })],
    });
    const params = r.parameters as unknown[];
    // params[0] = projectId, params[1] = from, params[2] = to, params[3] = 'env', params[4] = 'prod'
    expect(params[3]).toBe('env');
    expect(params[4]).toBe('prod');
  });
});
