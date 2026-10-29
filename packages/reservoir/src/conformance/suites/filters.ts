// Direct filter conformance: legacy `search`/`searchMode` through the client
// conversion, typed `exclude`, `spanId`, metadata filters with
// `include_missing: false`, hand-built `textQuery`, and the narrowing merge of
// a parsed query into typed params (P11 to P13, the "create alert from this
// search" path).

import { describe } from 'vitest';
import type { ConformanceContext, LogCase } from '../harness.js';
import { runLogCases } from '../harness.js';
import { S2, T1 } from '../corpus.js';

export const FILTER_CASES: LogCase[] = [
  { id: 'P01', title: 'legacy substring search', params: { search: 'connection refused', searchMode: 'substring' }, expected: ['L02'] },
  { id: 'P02', title: 'legacy fulltext search is the AND of its words', params: { search: 'Connection Refused' }, expected: ['L02'] },
  { id: 'P03', title: 'legacy explicit fulltext search', params: { search: 'timeout redis', searchMode: 'fulltext' }, expected: ['L04'] },
  { id: 'P04', title: 'legacy fulltext search splits punctuation', params: { search: '/var/lib' }, expected: ['L07'] },
  {
    id: 'P05', title: 'exclude levels and a service', params: { exclude: { level: ['info', 'debug'], service: ['auth'] } },
    expected: ['L02', 'L03', 'L04', 'L07', 'L14', 'L16', 'L19', 'L20', 'L22'],
  },
  {
    id: 'P06', title: 'a hostname exclusion keeps logs without a hostname', params: { exclude: { hostname: ['web-1'] } },
    expected: ['L03', 'L04', 'L05', 'L07', 'L08', 'L09', 'L10', 'L13', 'L14', 'L15', 'L19', 'L20', 'L21', 'L25'],
  },
  { id: 'P07', title: 'span id filter', params: { spanId: S2 }, expected: ['L17'] },
  {
    id: 'P08', title: 'a value exclusion with include_missing false drops logs without the key',
    params: { metadataFilters: [{ key: 'env', op: 'not_equals', value: 'prod', include_missing: false }] },
    expected: ['L04', 'L05'],
  },
  {
    id: 'P09', title: 'a hand-built any-of group mixing a word and a phrase',
    params: { textQuery: { all: [], anyOf: [[{ kind: 'word', value: 'timeout' }, { kind: 'phrase', value: 'refused by' }]], none: [] } },
    expected: ['L02', 'L03', 'L04', 'L19'],
  },
  {
    id: 'P10', title: 'typed levels AND a text query',
    params: { level: ['warn', 'critical'], textQuery: { all: [{ kind: 'word', value: 'timeout' }], anyOf: [], none: [] } },
    expected: ['L03', 'L19'],
  },
  { id: 'P11', title: 'a query service list narrows typed services', q: 'service:(auth OR billing)', params: { service: ['api', 'auth'] }, expected: ['L08', 'L09', 'L10', 'L11'] },
  { id: 'P12', title: 'a conflicting trace id matches nothing', q: `trace:${T1}`, params: { traceId: 'other' }, expected: [] },
  { id: 'P13', title: 'legacy search folds into the query text', q: 'timeout', params: { search: 'redis' }, expected: ['L04'] },
];

export function describeFilterConformance(ctx: ConformanceContext): void {
  describe('direct filters', () => {
    runLogCases(ctx, FILTER_CASES);
  });
}
