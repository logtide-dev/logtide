import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/api/traces', () => ({ tracesAPI: { getTrace: vi.fn() } }));

import { resolveTraceProject } from './trace-resolve';

describe('resolveTraceProject', () => {
  it('returns the first project that has the trace', async () => {
    const fetchTrace = vi.fn(async (_t: string, pid: string) => {
      if (pid === 'p2' || pid === 'p3') return { trace_id: 't' };
      throw new Error('404');
    });
    expect(await resolveTraceProject('t', ['p1', 'p2', 'p3'], fetchTrace)).toBe('p2');
    expect(fetchTrace).toHaveBeenCalledTimes(2);
  });

  it('returns null when no candidate has it', async () => {
    const fetchTrace = vi.fn(async () => {
      throw new Error('404');
    });
    expect(await resolveTraceProject('t', ['p1', 'p2'], fetchTrace)).toBeNull();
  });

  it('returns null without candidates', async () => {
    const fetchTrace = vi.fn();
    expect(await resolveTraceProject('t', [], fetchTrace)).toBeNull();
    expect(fetchTrace).not.toHaveBeenCalled();
  });

  it('a rejected lookup does not abort the scan', async () => {
    const fetchTrace = vi.fn(async (_t: string, pid: string) => {
      if (pid === 'p1') throw new Error('boom');
      return { ok: true };
    });
    expect(await resolveTraceProject('t', ['p1', 'p2'], fetchTrace)).toBe('p2');
  });

  it('stops after 20 candidates', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `p${i}`);
    const fetchTrace = vi.fn(async () => {
      throw new Error('404');
    });
    expect(await resolveTraceProject('t', ids, fetchTrace)).toBeNull();
    expect(fetchTrace).toHaveBeenCalledTimes(20);
  });

  it('skips duplicate candidates', async () => {
    const fetchTrace = vi.fn(async () => {
      throw new Error('404');
    });
    await resolveTraceProject('t', ['p1', 'p1', '', 'p2'], fetchTrace);
    expect(fetchTrace).toHaveBeenCalledTimes(2);
  });
});
