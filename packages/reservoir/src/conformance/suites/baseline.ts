// Baseline conformance: the corpus round trips, project scoping, and the
// client mappings every later suite relies on.

import { describe, expect, it } from 'vitest';
import type { ConformanceContext } from '../harness.js';
import { logIdsOf, runLogCases, spanIdsOf, traceIdsOf } from '../harness.js';
import {
  CORPUS_SPANS,
  PROJECT_A,
  PROJECT_A_WINDOW_LOG_IDS,
  PROJECT_B,
  SESSION_IDS,
  S1,
  T1,
  WINDOW,
  corpusSpan,
} from '../corpus.js';

const POSTS = Array.from({ length: 10 }, (_, i) => `POST-${i + 1}`);

export function describeBaselineConformance(ctx: ConformanceContext): void {
  describe('baseline', () => {
    runLogCases(ctx, [
      { id: 'B01', title: 'query returns every in-window project A log', expected: [...PROJECT_A_WINDOW_LOG_IDS] },
      { id: 'B03', title: 'project B only sees its own logs', projectIds: [PROJECT_B], expected: ['L90', 'L92'] },
    ]);

    it('B02 count matches', async () => {
      const { count } = await ctx.subject().count({ projectId: PROJECT_A, ...WINDOW });
      expect(count).toBe(25);
    });

    it('B09 the out-of-window log is only found with a wider window', async () => {
      const subject = ctx.subject();
      const inWindow = await subject.query({ projectId: PROJECT_A, ...WINDOW, limit: 1000 });
      expect(logIdsOf(inWindow.logs)).not.toContain('L91');
      const wide = await subject.query({ projectId: PROJECT_A, from: new Date(WINDOW.from.getTime() - 2 * 86_400_000), to: WINDOW.to, limit: 1000 });
      expect(logIdsOf(wide.logs)).toContain('L91');
      expect(wide.logs).toHaveLength(26);
    });

    it('B04 spans round trip', async () => {
      const result = await ctx.subject().querySpans({ projectId: PROJECT_A, ...WINDOW, limit: 1000 });
      const ids = spanIdsOf(result.spans);
      expect(ids).toHaveLength(129);
      expect(ids).not.toContain('B-SPAN');
      expect(ids).not.toContain('X-SPAN');
      const expected = CORPUS_SPANS.map((s) => s.id).filter((id) => id !== 'B-SPAN' && id !== 'X-SPAN');
      expect([...ids].sort()).toEqual([...expected].sort());
    });

    it('B05 traces round trip', async () => {
      const result = await ctx.subject().queryTraces({ projectId: PROJECT_A, ...WINDOW, limit: 100 });
      const expected = ['TF1', 'TF2', 'TF3', ...Array.from({ length: 10 }, (_, i) => `TO${String(i + 1).padStart(2, '0')}`), 'TW1'];
      expect(traceIdsOf(result.traces).sort()).toEqual(expected.sort());
    });

    it('B06 log fields survive storage', async () => {
      const result = await ctx.subject().query({ projectId: PROJECT_A, ...WINDOW, limit: 1000 });
      const byId = new Map(logIdsOf(result.logs).map((id, i) => [id, result.logs[i]]));
      const l16 = byId.get('L16');
      expect(l16).toBeDefined();
      expect(l16!.traceId).toBe(T1);
      expect(l16!.spanId).toBe(S1);
      expect(l16!.sessionId).toBe(SESSION_IDS.SESS1);
      expect(l16!.metadata?.hostname).toBe('web-1');
      expect(l16!.service).toBe('api');
      expect(l16!.level).toBe('error');
      const l14 = byId.get('L14');
      expect(l14).toBeDefined();
      expect(l14!.metadata).toEqual({ hostname: 'web-2', env: 'prod', reason: 'card_declined', amount: 1999, ok: false, note: null });
    });

    it('B07 span fields survive storage', async () => {
      const result = await ctx.subject().querySpans({ projectId: PROJECT_A, ...WINDOW, limit: 1000 });
      const ids = spanIdsOf(result.spans);
      const span = result.spans[ids.indexOf('GET-96')];
      expect(span).toBeDefined();
      expect(span.kind).toBe('SERVER');
      expect(span.statusCode).toBe('ERROR');
      expect(span.durationMs).toBe(96);
      expect(span.attributes).toEqual({ 'http.method': 'GET', 'http.status_code': 500 });
      expect(span.parentSpanId).toBe(corpusSpan('PAGE-3').spanId);
    });

    it('B08 span operation alias and duration sort work through the client', async () => {
      const subject = ctx.subject();
      const byOperation = await subject.querySpans({ projectId: PROJECT_A, ...WINDOW, operation: 'POST /orders', limit: 1000 });
      expect(spanIdsOf(byOperation.spans).sort()).toEqual([...POSTS].sort());
      const slowest = await subject.querySpans({
        projectId: PROJECT_A, ...WINDOW, serviceName: 'api', kind: 'SERVER', sortBy: 'duration', sortOrder: 'desc', limit: 3,
      });
      expect(spanIdsOf(slowest.spans)).toEqual(['POST-10', 'POST-9', 'POST-8']);
    });
  });
}
