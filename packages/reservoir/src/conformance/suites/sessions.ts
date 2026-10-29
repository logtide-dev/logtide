// Sessions conformance (orchestrator ruling, plan D6): logs in range with a
// non-empty session id grouped by session, the optional service filter
// applied to events first, the byte-order smallest service per session,
// errors = error + critical, order last event desc then session id byte
// order, and cursors that continue strictly after the last row.

import { describe, expect, it } from 'vitest';
import type { ListSessionsParams, ListSessionsResult } from '../../core/types.js';
import type { ConformanceContext } from '../harness.js';
import { CONFORMANCE_BASE, PROJECT_A, PROJECT_B, SESSION_IDS, WINDOW, minutes } from '../corpus.js';

type SessionRow = [session: string, service: string, firstT: number, lastT: number, eventCount: number, errorCount: number];

const SESSION_NAMES = new Map<string, string>(Object.entries(SESSION_IDS).map(([name, id]) => [id, name]));
const t = (d: Date): number => (d.getTime() - CONFORMANCE_BASE.getTime()) / 60_000;

function rowsOf(result: ListSessionsResult): SessionRow[] {
  return result.sessions.map((s) => [
    SESSION_NAMES.get(s.sessionId) ?? `UNKNOWN:${s.sessionId}`, s.service, t(s.firstEvent), t(s.lastEvent), s.eventCount, s.errorCount,
  ]);
}

export function describeSessionsConformance(ctx: ConformanceContext): void {
  describe('sessions', () => {
    const list = (params: Partial<ListSessionsParams>) =>
      ctx.subject().listSessions({ projectId: PROJECT_A, ...WINDOW, limit: 10, ...params });

    it('SE01 every session of the window, most recent first', async () => {
      const result = await list({});
      expect(rowsOf(result)).toEqual([
        ['SESS4', 'api', 21, 24, 2, 0],
        ['SESS1', 'api', 16, 17, 2, 1],
        ['SESS2', 'api', 8, 12, 3, 1],
        ['SESS3', 'api', 7, 7, 1, 1],
      ]);
      expect(result.nextCursor).toBeUndefined();
    });

    it('SE02 a cursor continues strictly after the last row', async () => {
      const first = await list({ limit: 2 });
      expect(rowsOf(first).map(([s]) => s)).toEqual(['SESS4', 'SESS1']);
      expect(typeof first.nextCursor).toBe('string');
      const second = await list({ limit: 2, cursor: first.nextCursor });
      expect(rowsOf(second)).toEqual([
        ['SESS2', 'api', 8, 12, 3, 1],
        ['SESS3', 'api', 7, 7, 1, 1],
      ]);
      expect(second.nextCursor).toBeUndefined();
    });

    it('SE03 a full last page has no cursor', async () => {
      const result = await list({ limit: 4 });
      expect(result.sessions).toHaveLength(4);
      expect(result.nextCursor).toBeUndefined();
    });

    it('SE04 the service filter applies to events before grouping', async () => {
      expect(rowsOf(await list({ service: 'auth' }))).toEqual([['SESS2', 'auth', 8, 9, 2, 1]]);
    });

    it('SE05 a service seen in one event of a session', async () => {
      expect(rowsOf(await list({ service: 'search' }))).toEqual([['SESS4', 'search', 24, 24, 1, 0]]);
    });

    it('SE06 a narrower window regroups the sessions', async () => {
      expect(rowsOf(await list({ from: minutes(10), to: minutes(20) }))).toEqual([
        ['SESS1', 'api', 16, 17, 2, 1],
        ['SESS2', 'api', 12, 12, 1, 0],
      ]);
    });

    it('SE07 ties on the last event are broken by session id byte order', async () => {
      const first = await list({ projectId: PROJECT_B, limit: 1 });
      expect(rowsOf(first)).toEqual([['SESS8', 'api', 5, 5, 1, 0]]);
      expect(typeof first.nextCursor).toBe('string');
      const second = await list({ projectId: PROJECT_B, limit: 1, cursor: first.nextCursor });
      expect(rowsOf(second)).toEqual([['SESS9', 'api', 5, 5, 1, 1]]);
      expect(second.nextCursor).toBeUndefined();
    });

    it('SE08 an invalid cursor rejects with RangeError', async () => {
      await expect(list({ cursor: 'not a cursor' })).rejects.toBeInstanceOf(RangeError);
    });

    it('SE09 hasSessions ignores empty session ids and other windows', async () => {
      const subject = ctx.subject();
      expect(await subject.hasSessions({ projectId: PROJECT_A, ...WINDOW })).toBe(true);
      expect(await subject.hasSessions({ projectId: PROJECT_A, from: minutes(1), to: minutes(6) })).toBe(false);
      expect(await subject.hasSessions({ projectId: PROJECT_A, from: minutes(25), to: minutes(120) })).toBe(false);
      expect(await subject.hasSessions({ projectId: PROJECT_B, ...WINDOW })).toBe(true);
    });
  });
}
