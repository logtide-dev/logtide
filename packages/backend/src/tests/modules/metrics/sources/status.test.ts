import { describe, it, expect } from 'vitest';
import { SOURCE_TEMPLATES } from '@logtide/shared';
import {
  buildDashboardPanels,
  computeHostStatus,
  computeServiceStatus,
  formatQuietFor,
  lastNonNull,
  pickInterval,
} from '../../../../modules/metrics/sources/status.js';

const NOW = 1_700_000_000_000;
const fresh = NOW - 60_000;
const base = { now: NOW, lastSeen: fresh, cpu: 10, memory: 20, disk: 30, hardware: [] };

describe('computeHostStatus', () => {
  it('is ok when everything is below thresholds', () => {
    expect(computeHostStatus(base)).toEqual({ status: 'ok', reason: null });
  });

  it('is stale with a human reason when quiet too long', () => {
    const r = computeHostStatus({ ...base, lastSeen: NOW - 14 * 60_000, disk: 99 });
    expect(r).toEqual({ status: 'stale', reason: 'No data for 14 min' });
  });

  it('warns and goes critical on thresholds', () => {
    expect(computeHostStatus({ ...base, disk: 85 })).toEqual({ status: 'warning', reason: 'Disk at 85%' });
    expect(computeHostStatus({ ...base, cpu: 97 })).toEqual({ status: 'critical', reason: 'CPU at 97%' });
    expect(computeHostStatus({ ...base, memory: 85 }).status).toBe('warning');
  });

  it('worst wins across signals', () => {
    const r = computeHostStatus({ ...base, cpu: 90, disk: 93 });
    expect(r).toEqual({ status: 'critical', reason: 'Disk at 93%' });
  });

  it('hardware critical wins and uses the finding message', () => {
    const r = computeHostStatus({
      ...base,
      cpu: 90,
      hardware: [{ status: 'critical', findingMessage: 'disk failing' }],
    });
    expect(r).toEqual({ status: 'critical', reason: 'Hardware: disk failing' });
  });

  it('hardware stale or unknown never downgrades a fresh host', () => {
    const r = computeHostStatus({
      ...base,
      hardware: [
        { status: 'stale', findingMessage: null },
        { status: 'unknown', findingMessage: null },
      ],
    });
    expect(r.status).toBe('ok');
  });

  it('is unknown with nothing to judge', () => {
    const r = computeHostStatus({ ...base, cpu: null, memory: null, disk: null });
    expect(r.status).toBe('unknown');
  });

  it('a hardware ok row counts as judged', () => {
    const r = computeHostStatus({
      ...base,
      cpu: null,
      memory: null,
      disk: null,
      hardware: [{ status: 'ok', findingMessage: null }],
    });
    expect(r.status).toBe('ok');
  });
});

describe('computeServiceStatus', () => {
  const s = { now: NOW, lastSeen: fresh };
  it('maps error rate to status', () => {
    expect(computeServiceStatus({ ...s, errorRate: 0.2 }).status).toBe('ok');
    expect(computeServiceStatus({ ...s, errorRate: 1 })).toEqual({ status: 'warning', reason: 'Error rate at 1.0%' });
    expect(computeServiceStatus({ ...s, errorRate: 6.25 }).status).toBe('critical');
    expect(computeServiceStatus({ ...s, errorRate: null }).status).toBe('ok');
  });
  it('is stale when quiet', () => {
    expect(computeServiceStatus({ now: NOW, lastSeen: NOW - 3 * 3_600_000, errorRate: 50 })).toEqual({
      status: 'stale',
      reason: 'No data for 3 h',
    });
  });
});

describe('helpers', () => {
  it('formats quiet durations', () => {
    expect(formatQuietFor(30_000)).toBe('1 min');
    expect(formatQuietFor(5 * 3_600_000)).toBe('5 h');
    expect(formatQuietFor(5 * 86_400_000)).toBe('5 d');
  });
  it('picks about 24 buckets', () => {
    expect(pickInterval(6 * 3_600_000, 24)).toBe('15m');
    expect(pickInterval(24 * 3_600_000, 24)).toBe('1h');
    expect(pickInterval(30 * 86_400_000, 24)).toBe('1d');
    expect(pickInterval(60_000, 24)).toBe('1m');
  });
  it('takes the last non-null value', () => {
    expect(lastNonNull([1, 2, null])).toBe(2);
    expect(lastNonNull([null, null])).toBeNull();
    expect(lastNonNull([])).toBeNull();
  });
});

describe('buildDashboardPanels', () => {
  let n = 0;
  const id = () => `p${n++}`;

  it('lays panels out in rows of 12 columns, sections start new rows', () => {
    const panels = buildDashboardPanels(
      SOURCE_TEMPLATES.host,
      ['system.cpu.utilization', 'system.memory.usage', 'system.cpu.load_average.1m', 'system.filesystem.utilization', 'system.network.io.rate'],
      null,
      id,
    );
    const layouts = panels.map((p) => p.layout);
    // cpu + memory share row 0, load wraps to row 4 (h 4).
    expect(layouts[0]).toEqual({ x: 0, y: 0, w: 6, h: 4 });
    expect(layouts[1]).toEqual({ x: 6, y: 0, w: 6, h: 4 });
    expect(layouts[2]).toEqual({ x: 0, y: 4, w: 6, h: 4 });
    // Disks section starts a new row after the half-filled one.
    expect(layouts[3]).toEqual({ x: 0, y: 8, w: 6, h: 4 });
    // Network (w 12) starts its own row.
    expect(layouts[4]).toEqual({ x: 0, y: 12, w: 12, h: 4 });
    for (const l of layouts) expect(l.x + l.w).toBeLessThanOrEqual(12);
  });

  it('skips panels whose metrics are absent', () => {
    expect(buildDashboardPanels(SOURCE_TEMPLATES.host, [], null, id)).toEqual([]);
  });

  it('puts the requested projects into metrics queries and null into trace panels', () => {
    const projects = ['11111111-1111-1111-1111-111111111111'];
    const panels = buildDashboardPanels(SOURCE_TEMPLATES.service, ['process.cpu.utilization'], projects, id);
    const traces = panels.filter((p) => p.config.type === 'trace_volume' || p.config.type === 'trace_latency');
    const metrics = panels.filter((p) => p.config.type === 'metrics');
    expect(traces).toHaveLength(2);
    for (const t of traces) expect((t.config as { projectId: string | null }).projectId).toBeNull();
    expect(metrics).toHaveLength(1);
    expect((metrics[0].config as any).query.projectIds).toEqual(projects);
    // Template itself is not mutated.
    const tpl = SOURCE_TEMPLATES.service.sections.flatMap((s) => s.panels).find((p) => p.key === 'process-cpu')!;
    expect((tpl.config as any).query.projectIds).toBeNull();
  });

  it('null means all projects', () => {
    const panels = buildDashboardPanels(SOURCE_TEMPLATES.service, ['process.cpu.utilization'], null, id);
    const m = panels.find((p) => p.config.type === 'metrics')!;
    expect((m.config as any).query.projectIds).toBeNull();
  });
});
