/**
 * Golden Signals metric detection and configuration.
 * Maps well-known OTel metric names to signal panels.
 */

import { levelTone, stateTone } from './severity';

export type SignalType = 'request_rate' | 'error_rate' | 'latency' | 'saturation';

export interface SignalConfig {
  type: SignalType;
  title: string;
  description: string;
  /** OTel metric name patterns to detect (checked in order, first match wins) */
  metricPatterns: string[];
  /** Aggregation function(s) to use */
  aggregations: Array<{ fn: string; label: string; color: string }>;
  /** Unit label for the Y axis */
  unit: string;
  /** Optional: attribute filter to apply */
  attributeFilter?: Record<string, string>;
  /** Empty state hint */
  emptyHint: string;
}

export const SIGNAL_CONFIGS: SignalConfig[] = [
  {
    type: 'request_rate',
    title: 'Request Rate',
    description: 'Incoming requests per second',
    metricPatterns: [
      'http.server.request.duration',
      'http.server.request.count',
      'http.server.requests',
      'rpc.server.duration',
    ],
    aggregations: [{ fn: 'count', label: 'req/s', color: '#3b82f6' }],
    unit: 'req/s',
    emptyHint: 'Send http.server.request.duration or http.server.request.count to populate this panel',
  },
  {
    type: 'error_rate',
    title: 'Error Rate',
    description: 'Server errors per second',
    metricPatterns: [
      'http.server.error.count',
      'http.server.request.duration',
    ],
    aggregations: [{ fn: 'count', label: 'errors/s', color: levelTone('error').chart }],
    unit: 'errors/s',
    attributeFilter: { 'http.response.status_code': '500' },
    emptyHint: 'Send http.server.error.count or http.server.request.duration with status_code attributes to populate this panel',
  },
  {
    type: 'latency',
    title: 'Latency',
    description: 'Request duration percentiles',
    metricPatterns: [
      'http.server.request.duration',
      'rpc.server.duration',
      'http.server.duration',
    ],
    aggregations: [
      { fn: 'p50', label: 'p50', color: stateTone('ok').chart },
      { fn: 'p95', label: 'p95', color: levelTone('warn').chart },
      { fn: 'p99', label: 'p99', color: levelTone('error').chart },
    ],
    unit: 'ms',
    emptyHint: 'Send http.server.request.duration to populate this panel',
  },
  {
    type: 'saturation',
    title: 'Saturation',
    description: 'Resource utilization',
    metricPatterns: [
      'process.cpu.utilization',
      'system.cpu.utilization',
      'process.memory.usage',
      'system.memory.utilization',
    ],
    aggregations: [{ fn: 'avg', label: 'utilization', color: '#8b5cf6' }],
    unit: '%',
    emptyHint: 'Send process.cpu.utilization or system.cpu.utilization to populate this panel',
  },
];

/**
 * Given a list of available metric names, find the best match for each signal type.
 * Returns a map of signal type -> matched metric name (or null if not found).
 */
export function detectSignalMetrics(
  metricNames: Array<{ name: string; type: string }>,
): Record<SignalType, string | null> {
  const nameSet = new Set(metricNames.map(m => m.name));
  const result: Record<SignalType, string | null> = {
    request_rate: null,
    error_rate: null,
    latency: null,
    saturation: null,
  };

  for (const config of SIGNAL_CONFIGS) {
    for (const pattern of config.metricPatterns) {
      if (nameSet.has(pattern)) {
        result[config.type] = pattern;
        break;
      }
    }
  }

  return result;
}

/**
 * Get the SignalConfig for a given signal type.
 */
export function getSignalConfig(type: SignalType): SignalConfig {
  return SIGNAL_CONFIGS.find(c => c.type === type)!;
}
