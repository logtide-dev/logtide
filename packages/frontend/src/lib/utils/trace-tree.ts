import type { SpanRecord } from '$lib/api/traces';

export interface SpanNode extends SpanRecord {
  children: SpanNode[];
  depth: number;
}

/**
 * Build a tree of SpanNodes from a flat list of spans.
 * Spans whose parent_span_id is absent or not found in the list become root nodes.
 * Nodes at each level are sorted by start_time ascending.
 */
export function buildSpanTree(spans: SpanRecord[]): SpanNode[] {
  const spanMap = new Map<string, SpanNode>();
  const rootSpans: SpanNode[] = [];

  for (const span of spans) {
    spanMap.set(span.span_id, { ...span, children: [], depth: 0 });
  }

  for (const span of spans) {
    const node = spanMap.get(span.span_id)!;
    if (span.parent_span_id && spanMap.has(span.parent_span_id)) {
      const parent = spanMap.get(span.parent_span_id)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      rootSpans.push(node);
    }
  }

  const sortByTime = (a: SpanNode, b: SpanNode) =>
    new Date(a.start_time).getTime() - new Date(b.start_time).getTime();

  rootSpans.sort(sortByTime);

  function sortChildren(nodes: SpanNode[]) {
    nodes.sort(sortByTime);
    for (const node of nodes) {
      sortChildren(node.children);
    }
  }

  sortChildren(rootSpans);

  return rootSpans;
}

/**
 * Flatten a span tree into a list, respecting the expandedSpans set.
 * Children of a collapsed span are excluded from the result.
 */
export function flattenTree(
  nodes: SpanNode[],
  expandedSpans: Set<string>,
  result: SpanNode[] = []
): SpanNode[] {
  for (const node of nodes) {
    result.push(node);
    if (expandedSpans.has(node.span_id)) {
      flattenTree(node.children, expandedSpans, result);
    }
  }
  return result;
}

const SPAN_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-cyan-500',
  'bg-pink-500',
  'bg-yellow-500',
  'bg-indigo-500',
];

/**
 * Return a Tailwind color class for a span bar.
 * ERROR spans always get red; otherwise a stable color derived from the service name.
 */
export function getSpanColor(span: SpanRecord): string {
  if (span.status_code === 'ERROR') {
    return 'bg-destructive';
  }

  const hash = span.service_name.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);

  return SPAN_COLORS[Math.abs(hash) % SPAN_COLORS.length];
}

/**
 * Return the left offset (0-100%) of a span bar within the trace window.
 * Returns 0 when traceDuration is 0 to avoid division by zero.
 */
export function getSpanLeft(
  span: SpanRecord,
  traceStartTime: number,
  traceDuration: number
): number {
  if (traceDuration === 0) return 0;
  const spanStart = new Date(span.start_time).getTime();
  return ((spanStart - traceStartTime) / traceDuration) * 100;
}

/**
 * Return the width (0-100%) of a span bar within the trace window.
 * Returns 100 when traceDuration is 0 to avoid division by zero.
 * Enforces a minimum of 0.5% so sub-millisecond spans remain visible.
 */
export function getSpanWidth(span: SpanRecord, traceDuration: number): number {
  if (traceDuration === 0) return 100;
  return Math.max((span.duration_ms / traceDuration) * 100, 0.5);
}
