// ============================================================================
// Series shaping for MetricChartPanel
// ============================================================================
//
// Points without labels render as one line (unchanged behaviour). When any
// point carries labels (the panel has `groupBy`), one line per distinct label
// combination is built on a shared, sorted time axis; the legend entry is
// `key=value` joined by ", ".

export interface MetricPoint {
  time: string;
  value: number;
  labels?: Record<string, string>;
}

export interface ShapedSeries {
  name: string;
  data: Array<number | null>;
}

export interface ShapedMetricSeries {
  times: string[];
  series: ShapedSeries[];
  grouped: boolean;
}

export function labelCombination(labels: Record<string, string> | undefined): string {
  if (!labels) return '';
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(', ');
}

export function shapeMetricSeries(points: MetricPoint[], defaultName: string): ShapedMetricSeries {
  const grouped = points.some((p) => p.labels && Object.keys(p.labels).length > 0);
  if (!grouped) {
    return {
      times: points.map((p) => p.time),
      series: [{ name: defaultName, data: points.map((p) => p.value) }],
      grouped: false,
    };
  }

  const times = [...new Set(points.map((p) => p.time))].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );
  const timeIndex = new Map(times.map((t, i) => [t, i]));
  const byName = new Map<string, Array<number | null>>();
  for (const p of points) {
    const name = labelCombination(p.labels) || defaultName;
    let data = byName.get(name);
    if (!data) {
      data = times.map(() => null);
      byName.set(name, data);
    }
    data[timeIndex.get(p.time) as number] = p.value;
  }
  return {
    times,
    series: [...byName.entries()].map(([name, data]) => ({ name, data })),
    grouped: true,
  };
}
