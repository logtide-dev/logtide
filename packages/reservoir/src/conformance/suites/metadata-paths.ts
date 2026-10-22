// Metadata path conformance (shared `metadataPathCandidates`): a dotted key
// resolves through the literal key, then a leading key, plain segments and a
// trailing key (longest leading key first, then longest trailing key), so
// OTLP resource attributes (`resource` -> "service.name") and structured
// bodies ("otel.body" -> user -> id) are addressable on every engine, in
// filters, facets and top values alike.

import { describe, expect, it } from 'vitest';
import type { ConformanceContext, LogCase } from '../harness.js';
import { logCaseParams, runLogCases } from '../harness.js';
import type { LogFacetsParams } from '../../core/types.js';
import { minutes, PROJECT_C, PROJECT_D } from '../corpus.js';

const D = [PROJECT_D];
const D_LOGS = ['L40', 'L41', 'L42', 'L43'];
const except = (...ids: string[]): string[] => D_LOGS.filter((id) => !ids.includes(id));

export const METADATA_PATH_CASES: LogCase[] = [
  { id: 'R01', title: 'a literal dotted child under a nested parent (OTLP resource)', q: 'resource.service.name:checkout', projectIds: D, expected: ['L40'] },
  { id: 'R02', title: 'a value list on a resource attribute', q: 'resource.host.name:(web-1 OR web-2)', projectIds: D, expected: ['L40', 'L41'] },
  { id: 'R03', title: 'an excluded resource attribute keeps logs without it', q: '-resource.service.name:checkout', projectIds: D, expected: except('L40') },
  { id: 'R04', title: 'a resource attribute exists', q: 'resource.service.name:*', projectIds: D, expected: ['L40', 'L41'] },
  { id: 'R05', title: 'contains on a resource attribute', q: 'resource.service.name:*ECK*', projectIds: D, expected: ['L40'] },
  { id: 'R06', title: 'a dotted child under a dotted parent (OTLP body)', q: 'otel.body.http.route:"/pay"', projectIds: D, expected: ['L40'] },
  { id: 'R07', title: 'a nested path under a dotted parent', q: 'otel.body.user.id:7', projectIds: D, expected: ['L40'] },
  { id: 'R08', title: 'a literal child beats the nested path', q: 'a.b.c:literal-child', projectIds: D, expected: ['L42'] },
  { id: 'R09', title: 'a nested value hidden by a literal child', q: 'a.b.c:deep', projectIds: D, expected: [] },
  { id: 'R10', title: 'the longest leading key wins', q: 'a.b.c:dotted-parent', projectIds: D, expected: ['L43'] },
  { id: 'R11', title: 'a dotted child hidden by a longer leading key', q: 'a.b.c:dotted-child', projectIds: D, expected: [] },
  { id: 'R12', title: 'a discovered dotted child key (D05) filters', q: 'otel.service.name:checkout', projectIds: [PROJECT_C], window: { from: minutes(0), to: minutes(3) }, expected: ['L93'] },
  { id: 'R13', title: 'a discovered dotted child key with dashes inside', q: 'otel.k8s.pod.name:pod-1', projectIds: [PROJECT_C], window: { from: minutes(0), to: minutes(3) }, expected: ['L93'] },
];

export function describeMetadataPathConformance(ctx: ConformanceContext): void {
  describe('metadata paths', () => {
    runLogCases(ctx, METADATA_PATH_CASES);

    it('R20 facets resolve the same paths', async () => {
      const params = { ...logCaseParams({ projectIds: D }), fields: [{ metadata: 'resource.service.name' }, { metadata: 'otel.body.user.id' }, { metadata: 'a.b.c' }] } as LogFacetsParams;
      const { facets } = await ctx.subject().facets(params);
      expect(facets.map((f) => [f.field, f.values.map((v) => `${v.value} ${v.count}`), f.otherCount])).toEqual([
        ['metadata.resource.service.name', ['cart 1', 'checkout 1'], 0],
        ['metadata.otel.body.user.id', ['7 1'], 0],
        ['metadata.a.b.c', ['dotted-parent 1', 'literal-child 1'], 0],
      ]);
    });
  });
}
