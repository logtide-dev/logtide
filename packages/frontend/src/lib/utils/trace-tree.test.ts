import { describe, it, expect } from 'vitest';
import {
  buildSpanTree,
  flattenTree,
  getSpanColor,
  getSpanLeft,
  getSpanWidth,
  type SpanNode,
} from './trace-tree';
import type { SpanRecord } from '$lib/api/traces';

// Minimal SpanRecord factory
function makeSpan(
  overrides: Partial<SpanRecord> & { span_id: string; service_name: string }
): SpanRecord {
  return {
    trace_id: 'trace-1',
    parent_span_id: null,
    operation_name: 'op',
    start_time: new Date(1000).toISOString(),
    end_time: new Date(2000).toISOString(),
    duration_ms: 1000,
    kind: 'INTERNAL',
    status_code: 'OK',
    status_message: null,
    attributes: null,
    events: null,
    links: null,
    resource_attributes: null,
    ...overrides,
  };
}

describe('buildSpanTree', () => {
  it('builds a parent-child tree', () => {
    const spans: SpanRecord[] = [
      makeSpan({ span_id: 'root', service_name: 'svc-a', start_time: new Date(1000).toISOString() }),
      makeSpan({ span_id: 'child1', parent_span_id: 'root', service_name: 'svc-b', start_time: new Date(1100).toISOString() }),
      makeSpan({ span_id: 'child2', parent_span_id: 'root', service_name: 'svc-c', start_time: new Date(1200).toISOString() }),
    ];
    const tree = buildSpanTree(spans);
    expect(tree).toHaveLength(1);
    expect(tree[0].span_id).toBe('root');
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].span_id).toBe('child1');
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[1].span_id).toBe('child2');
    expect(tree[0].children[1].depth).toBe(1);
  });

  it('treats span with unknown parent_span_id as root (orphan-as-root)', () => {
    const spans: SpanRecord[] = [
      makeSpan({ span_id: 'orphan', parent_span_id: 'non-existent-parent', service_name: 'svc-a' }),
    ];
    const tree = buildSpanTree(spans);
    expect(tree).toHaveLength(1);
    expect(tree[0].span_id).toBe('orphan');
    expect(tree[0].depth).toBe(0);
  });

  it('sorts root spans by start time', () => {
    const spans: SpanRecord[] = [
      makeSpan({ span_id: 'b', service_name: 'svc', start_time: new Date(2000).toISOString() }),
      makeSpan({ span_id: 'a', service_name: 'svc', start_time: new Date(1000).toISOString() }),
    ];
    const tree = buildSpanTree(spans);
    expect(tree[0].span_id).toBe('a');
    expect(tree[1].span_id).toBe('b');
  });

  it('sorts children by start time', () => {
    const spans: SpanRecord[] = [
      makeSpan({ span_id: 'root', service_name: 'svc', start_time: new Date(1000).toISOString() }),
      makeSpan({ span_id: 'c2', parent_span_id: 'root', service_name: 'svc', start_time: new Date(1300).toISOString() }),
      makeSpan({ span_id: 'c1', parent_span_id: 'root', service_name: 'svc', start_time: new Date(1100).toISOString() }),
    ];
    const tree = buildSpanTree(spans);
    expect(tree[0].children[0].span_id).toBe('c1');
    expect(tree[0].children[1].span_id).toBe('c2');
  });

  it('computes depth for nested spans', () => {
    const spans: SpanRecord[] = [
      makeSpan({ span_id: 'root', service_name: 'svc', start_time: new Date(1000).toISOString() }),
      makeSpan({ span_id: 'child', parent_span_id: 'root', service_name: 'svc', start_time: new Date(1100).toISOString() }),
      makeSpan({ span_id: 'grandchild', parent_span_id: 'child', service_name: 'svc', start_time: new Date(1200).toISOString() }),
    ];
    const tree = buildSpanTree(spans);
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });
});

describe('flattenTree', () => {
  function makeTree(): SpanNode[] {
    const child: SpanNode = {
      ...makeSpan({ span_id: 'child', parent_span_id: 'root', service_name: 'svc' }),
      children: [],
      depth: 1,
    };
    const root: SpanNode = {
      ...makeSpan({ span_id: 'root', service_name: 'svc' }),
      children: [child],
      depth: 0,
    };
    return [root];
  }

  it('includes all nodes when all are expanded', () => {
    const tree = makeTree();
    const expanded = new Set(['root', 'child']);
    const flat = flattenTree(tree, expanded);
    expect(flat.map(n => n.span_id)).toEqual(['root', 'child']);
  });

  it('excludes children of collapsed spans', () => {
    const tree = makeTree();
    const expanded = new Set<string>(); // root is collapsed
    const flat = flattenTree(tree, expanded);
    expect(flat.map(n => n.span_id)).toEqual(['root']);
  });

  it('always includes root-level spans regardless of expanded set', () => {
    const tree = makeTree();
    const expanded = new Set<string>();
    const flat = flattenTree(tree, expanded);
    expect(flat[0].span_id).toBe('root');
  });
});

describe('getSpanLeft', () => {
  it('returns correct left percentage for span at 25% of window', () => {
    const traceStart = 1000;
    const traceDuration = 1000;
    const span = makeSpan({ span_id: 'x', service_name: 'svc', start_time: new Date(1250).toISOString() });
    const left = getSpanLeft(span, traceStart, traceDuration);
    expect(left).toBeCloseTo(25);
  });

  it('returns 0 when traceDuration is 0 (zero-duration safety)', () => {
    const span = makeSpan({ span_id: 'x', service_name: 'svc', start_time: new Date(1000).toISOString() });
    expect(getSpanLeft(span, 1000, 0)).toBe(0);
  });
});

describe('getSpanWidth', () => {
  it('returns correct width percentage for span covering 50% of window', () => {
    const traceDuration = 1000;
    const span = makeSpan({ span_id: 'x', service_name: 'svc', duration_ms: 500 });
    const width = getSpanWidth(span, traceDuration);
    expect(width).toBeCloseTo(50);
  });

  it('returns 100 when traceDuration is 0 (zero-duration safety)', () => {
    const span = makeSpan({ span_id: 'x', service_name: 'svc', duration_ms: 0 });
    expect(getSpanWidth(span, 0)).toBe(100);
  });

  it('returns at least 0.5 for very short spans', () => {
    const span = makeSpan({ span_id: 'x', service_name: 'svc', duration_ms: 1 });
    const width = getSpanWidth(span, 1000000);
    expect(width).toBeGreaterThanOrEqual(0.5);
  });

  it('returns correct width for span at 25%-75% of window', () => {
    // span starts at 25% and ends at 75%: duration = 50% of total
    const traceDuration = 1000;
    const span = makeSpan({ span_id: 'x', service_name: 'svc', duration_ms: 500 });
    const width = getSpanWidth(span, traceDuration);
    expect(width).toBeCloseTo(50);
  });
});

describe('getSpanColor', () => {
  it('returns error color for ERROR status', () => {
    const span = makeSpan({ span_id: 'x', service_name: 'any-service', status_code: 'ERROR' });
    expect(getSpanColor(span)).toBe('bg-destructive');
  });

  it('returns the same color for the same service name', () => {
    const span1 = makeSpan({ span_id: 'x', service_name: 'my-service', status_code: 'OK' });
    const span2 = makeSpan({ span_id: 'y', service_name: 'my-service', status_code: 'OK' });
    expect(getSpanColor(span1)).toBe(getSpanColor(span2));
  });

  it('may return different colors for different services', () => {
    // At minimum, we verify valid palette colors are returned
    const services = ['svc-alpha', 'svc-beta', 'svc-gamma', 'svc-delta'];
    const validColors = [
      'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500',
      'bg-cyan-500', 'bg-pink-500', 'bg-yellow-500', 'bg-indigo-500',
    ];
    for (const svc of services) {
      const color = getSpanColor(makeSpan({ span_id: svc, service_name: svc, status_code: 'OK' }));
      expect(validColors).toContain(color);
    }
  });

  it('error color takes precedence over service color', () => {
    // Even a service that would otherwise get a non-red palette color returns red on error
    const span = makeSpan({ span_id: 'x', service_name: 'stable-service', status_code: 'ERROR' });
    expect(getSpanColor(span)).toBe('bg-destructive');
  });
});
