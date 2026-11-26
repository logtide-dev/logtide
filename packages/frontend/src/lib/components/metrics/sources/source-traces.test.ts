import { describe, it, expect } from 'vitest';
import { buildLatencyOption, buildRequestsOption, errorRate, sourceTraceAttr, sourceTracesHref } from './source-traces';

const buckets = [
  { time: '2026-11-26T10:00:00.000Z', requests: 10, errors: 2, p95: 120 },
  { time: '2026-11-26T10:05:00.000Z', requests: 0, errors: 0, p95: null },
];
const input = { buckets, bucketSeconds: 300, colors: { ok: '#00f', error: '#f00', latency: '#fa0' }, formatAxis: (ms: number) => String(ms) };

describe('source trace filter', () => {
  it('matches spans of the host or of the service', () => {
    expect(sourceTraceAttr('host', 'vps-app')).toBe('resource.host.name:vps-app');
    expect(sourceTraceAttr('service', 'checkout-api')).toBe('resource.service.name:checkout-api');
    expect(sourceTraceAttr('host', 'my host')).toBe('resource.host.name:"my host"');
  });

  it('narrows a host to one of its services', () => {
    expect(sourceTraceAttr('host', 'vps-app', 'orders-service')).toBe('resource.host.name:vps-app resource.service.name:orders-service');
    // a service page has no service filter
    expect(sourceTraceAttr('service', 'api', 'other')).toBe('resource.service.name:api');
  });
});

describe('source traces link', () => {
  it('opens the Traces explorer with the filter, project and window', () => {
    const url = new URL(
      sourceTracesHref({
        attr: 'resource.host.name:vps-app',
        errorsOnly: true,
        projectId: 'p1',
        from: '2026-11-26T10:00:00.000Z',
        to: '2026-11-26T11:00:00.000Z',
      }),
      'http://x',
    );
    expect(url.pathname).toBe('/dashboard/traces');
    expect(url.searchParams.get('attr')).toBe('resource.host.name:vps-app');
    expect(url.searchParams.get('status')).toBe('errors');
    expect(url.searchParams.get('project')).toBe('p1');
    expect(url.searchParams.get('from')).toBe('2026-11-26T10:00:00.000Z');
  });

  it('leaves status and project out when not set', () => {
    const url = new URL(sourceTracesHref({ attr: 'a:b', errorsOnly: false, projectId: null, from: 'f', to: 't' }), 'http://x');
    expect(url.searchParams.has('status')).toBe(false);
    expect(url.searchParams.has('project')).toBe(false);
  });
});

describe('trace activity charts', () => {
  it('error rate is null without requests', () => {
    expect(errorRate({ requests: 0, errors: 0 })).toBeNull();
    expect(errorRate({ requests: 200, errors: 5 })).toBe(2.5);
  });

  it('stacks OK and error requests at the middle of each bucket', () => {
    const option = buildRequestsOption(input) as unknown as { series: Array<{ name: string; data: Array<[number, number]> }> };
    const [ok, errors] = option.series;
    const mid = Date.parse(buckets[0].time) + 150_000;
    expect(ok.name).toBe('OK');
    expect(ok.data[0]).toEqual([mid, 8]);
    expect(errors.data[0]).toEqual([mid, 2]);
    expect(ok.data[1][1]).toBe(0);
  });

  it('leaves a gap in p95 where there were no requests', () => {
    const option = buildLatencyOption(input) as unknown as { series: Array<{ data: Array<[number, number | null]> }> };
    expect(option.series[0].data.map((d) => d[1])).toEqual([120, null]);
  });
});
