import { describe, expect, it } from 'vitest';
import { formatMetricValue, metricDisplayScale, metricUnitFamily, metricUnitLabel } from './units.js';

describe('metricUnitFamily', () => {
  it.each([
    [null, 'none'],
    ['%', 'percent'],
    ['1', 'ratio'],
    ['By', 'bytes'],
    ['MiBy', 'bytes'],
    ['By/s', 'bytes_rate'],
    ['bit/s', 'bits_rate'],
    ['ms', 'duration'],
    ['s', 'duration'],
    ['Cel', 'temperature'],
    ['{request}', 'count'],
    ['{operation}/s', 'rate'],
    ['rpm', 'other'],
  ])('%s is %s', (unit, family) => {
    expect(metricUnitFamily(unit)).toBe(family);
  });
});

describe('formatMetricValue', () => {
  it('formats percentages and utilization ratios', () => {
    expect(formatMetricValue(71.234, '%')).toBe('71.2%');
    expect(formatMetricValue(0.5, '1', 'system.cpu.utilization')).toBe('50%');
    expect(formatMetricValue(2.53, '1', 'system.cpu.load_average.1m')).toBe('2.53');
  });

  it('scales bytes and byte rates with binary units', () => {
    expect(formatMetricValue(512, 'By')).toBe('512 B');
    expect(formatMetricValue(17_183_499_264, 'By')).toBe('16 GB');
    expect(formatMetricValue(1_258_291, 'By/s')).toBe('1.2 MB/s');
    expect(formatMetricValue(2, 'GiBy')).toBe('2 GB');
  });

  it('picks a readable duration unit', () => {
    expect(formatMetricValue(0.18, 's')).toBe('180 ms');
    expect(formatMetricValue(920, 'ms')).toBe('920 ms');
    expect(formatMetricValue(1_541_078, 's')).toBe('17.8 d');
    expect(formatMetricValue(250, 'us')).toBe('250 µs');
  });

  it('handles temperatures, rates, counts and unknown units', () => {
    expect(formatMetricValue(41.5, 'Cel')).toBe('41.5 °C');
    expect(formatMetricValue(22.33, '{operation}/s')).toBe('22.3/s');
    expect(formatMetricValue(145_500, '{request}')).toBe('145.5k');
    expect(formatMetricValue(1200, 'rpm')).toBe('1,200 rpm');
  });

  it('keeps small values readable', () => {
    expect(formatMetricValue(0.004, '{request}/s')).toBe('0.004/s');
    expect(formatMetricValue(0.00123, '%')).toBe('0.0012%');
    expect(formatMetricValue(0, '%')).toBe('0%');
  });

  it('shows n/a for missing values', () => {
    expect(formatMetricValue(null, '%')).toBe('n/a');
    expect(formatMetricValue(Number.NaN, 'By')).toBe('n/a');
  });
});

describe('metricUnitLabel and metricDisplayScale', () => {
  it('labels axes', () => {
    expect(metricUnitLabel('By/s')).toBe('bytes/s');
    expect(metricUnitLabel('1', 'system.memory.utilization')).toBe('%');
    expect(metricUnitLabel('{request}')).toBeNull();
  });

  it('scales ratio utilization to percent only', () => {
    expect(metricDisplayScale('1', 'system.memory.utilization')).toBe(100);
    expect(metricDisplayScale('%', 'system.memory.utilization')).toBe(1);
    expect(metricDisplayScale('1', 'system.cpu.load_average.5m')).toBe(1);
  });
});
