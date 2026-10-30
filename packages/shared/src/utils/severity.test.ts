import { describe, it, expect } from 'vitest';
import { getSeverityColor, getIncidentStatusColor } from './severity.js';

// Hex values mirror the chart colours of the frontend severity module
// (frontend/src/lib/utils/severity.ts): blue info, grey low, amber medium,
// red high, purple critical; open is neutral grey, acknowledged amber.
describe('severity palette', () => {
  it.each([
    ['critical', '#a855f7'],
    ['high', '#ef4444'],
    ['medium', '#f59e0b'],
    ['low', '#6b7280'],
    ['informational', '#3b82f6'],
  ] as const)('%s', (severity, hex) => {
    expect(getSeverityColor(severity)).toBe(hex);
  });

  it.each([
    ['open', '#6b7280'],
    ['investigating', '#f59e0b'],
    ['resolved', '#22c55e'],
    ['false_positive', '#6b7280'],
  ] as const)('incident %s', (status, hex) => {
    expect(getIncidentStatusColor(status)).toBe(hex);
  });
});
