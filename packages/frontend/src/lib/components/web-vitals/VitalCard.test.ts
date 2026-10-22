import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import VitalCard from './VitalCard.svelte';
import { percentages, formatVitalValue, thresholdsLine } from './format';

function metric(extra: Record<string, unknown> = {}) {
  return {
    name: 'LCP',
    p75: 2400,
    rating: 'good',
    samples: 100,
    distribution: { good: 80, needsImprovement: 15, poor: 5 },
    ...extra,
  } as never;
}

describe('VitalCard', () => {
  it('shows name, p75 in seconds above 1000 ms, rating chip and thresholds', () => {
    render(VitalCard, { props: { metric: metric() } });
    expect(screen.getByText('Largest Contentful Paint')).toBeInTheDocument();
    expect(screen.getByTestId('vital-value')).toHaveTextContent('2.4 s');
    expect(screen.getByTestId('vital-rating')).toHaveTextContent('Good');
    expect(screen.getByText('Good up to 2,500 ms, poor above 4,000 ms')).toBeInTheDocument();
  });

  it('shows No data when p75 is null', () => {
    render(VitalCard, {
      props: {
        metric: metric({ p75: null, rating: null, samples: 0, distribution: { good: 0, needsImprovement: 0, poor: 0 } }),
      },
    });
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByTestId('vital-value')).toBeNull();
  });

  it('distribution percentages sum to 100 and bar segments use rating tones', () => {
    render(VitalCard, {
      props: { metric: metric({ distribution: { good: 1, needsImprovement: 1, poor: 1 } }) },
    });
    const segs = screen.getAllByTestId('vital-segment');
    expect(segs).toHaveLength(3);
    const sum = segs.reduce((a, s) => a + Number(s.getAttribute('data-pct')), 0);
    expect(sum).toBe(100);
    expect(segs[0].className).toContain('bg-success');
    expect(segs[1].className).toContain('bg-warning');
    expect(segs[2].className).toContain('bg-destructive');
  });

  it('CLS formatted with three decimals and INP in ms', () => {
    const { unmount } = render(VitalCard, {
      props: { metric: metric({ name: 'CLS', p75: 0.1, rating: 'good' }) },
    });
    expect(screen.getByTestId('vital-value')).toHaveTextContent('0.100');
    expect(screen.getByText('Good up to 0.1, poor above 0.25')).toBeInTheDocument();
    unmount();
    render(VitalCard, { props: { metric: metric({ name: 'INP', p75: 187.6, rating: 'good' }) } });
    expect(screen.getByTestId('vital-value')).toHaveTextContent('188 ms');
  });
});

describe('format helpers', () => {
  it('percentages add up to 100', () => {
    expect(percentages([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(percentages([0, 0, 0])).toEqual([0, 0, 0]);
    expect(percentages([3, 0, 0])).toEqual([100, 0, 0]);
  });

  it('formats values and thresholds', () => {
    expect(formatVitalValue('TTFB', 1000)).toBe('1,000 ms');
    expect(formatVitalValue('TTFB', 1500)).toBe('1.5 s');
    expect(thresholdsLine('INP')).toBe('Good up to 200 ms, poor above 500 ms');
  });
});
