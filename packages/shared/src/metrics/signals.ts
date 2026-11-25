// ============================================================================
// Source signals and thresholds (1.8)
// ============================================================================
//
// The headline numbers of the sources list and the status rules. The names
// are the ones the LogTide hardware agent (1.1+) sends; hosts that send other
// conventions still appear, with null signals and the generic metric grid.

import type { MetricAttrFilter, MetricSpaceAggregation, MetricTimeAggregation } from './query.js';

/** A service whose metrics all start with these prefixes is an agent, not a service. */
export const HOST_METRIC_PREFIXES = ['system.', 'hw.'] as const;

/** No data for this long: the source is stale. */
export const SOURCE_STALE_AFTER_MS = 10 * 60 * 1000;

/** Points in a sources-list sparkline. */
export const SOURCE_SPARK_POINTS = 24;

export interface SourceSignalDef {
  metricName: string;
  aggregation: MetricTimeAggregation;
  /** How the series of one host combine (interfaces, mountpoints). */
  spaceAggregation: MetricSpaceAggregation;
  /** Unit of the resulting value. */
  unit: string;
  filters?: MetricAttrFilter[];
}

export type HostSignal = 'cpu' | 'memory' | 'disk' | 'network' | 'load';

export const HOST_SIGNALS: Record<HostSignal, SourceSignalDef> = {
  cpu: { metricName: 'system.cpu.utilization.total', aggregation: 'avg', spaceAggregation: 'avg', unit: '%' },
  memory: { metricName: 'system.memory.utilization', aggregation: 'avg', spaceAggregation: 'avg', unit: '%' },
  disk: { metricName: 'system.filesystem.utilization', aggregation: 'avg', spaceAggregation: 'max', unit: '%' },
  network: { metricName: 'system.network.io.rate', aggregation: 'avg', spaceAggregation: 'sum', unit: 'By/s' },
  load: { metricName: 'system.cpu.load_average.5m', aggregation: 'avg', spaceAggregation: 'avg', unit: '1' },
};

export interface SignalThreshold {
  warning: number;
  critical: number;
}

/** Percent thresholds on the latest value. */
export const HOST_THRESHOLDS: Record<'cpu' | 'memory' | 'disk', SignalThreshold> = {
  cpu: { warning: 85, critical: 95 },
  memory: { warning: 85, critical: 95 },
  disk: { warning: 80, critical: 90 },
};

/** Error % thresholds for services (from spans). */
export const SERVICE_ERROR_THRESHOLDS: SignalThreshold = { warning: 1, critical: 5 };

/** Worst status wins: critical > warning > stale > unknown > ok. */
export const SOURCE_STATUS_RANK = { ok: 0, unknown: 1, stale: 2, warning: 3, critical: 4 } as const;
