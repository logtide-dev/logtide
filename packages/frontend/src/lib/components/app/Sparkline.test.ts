import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Sparkline from './Sparkline.svelte';

function pointsOf(svg: Element): string[] {
  return svg.querySelector('polyline')!.getAttribute('points')!.split(' ');
}

describe('Sparkline', () => {
  it('renders one point per value with an accessible label', () => {
    render(Sparkline, { values: [1, 4, 2, 8], label: 'Logs per hour' });
    const svg = screen.getByRole('img', { name: 'Logs per hour' });
    expect(pointsOf(svg)).toHaveLength(4);
    expect(svg.getAttribute('class')).toContain('text-primary');
  });

  it('puts the max above the min', () => {
    render(Sparkline, { values: [0, 10], label: 'x' });
    const pts = pointsOf(screen.getByRole('img'));
    const y0 = Number(pts[0].split(',')[1]);
    const y1 = Number(pts[1].split(',')[1]);
    expect(y1).toBeLessThan(y0);
  });

  it('draws a flat line when every value is zero', () => {
    render(Sparkline, { values: [0, 0, 0], label: 'x' });
    const ys = new Set(pointsOf(screen.getByRole('img')).map((p) => p.split(',')[1]));
    expect(ys.size).toBe(1);
  });

  it('renders a dash for an empty array', () => {
    render(Sparkline, { values: [], label: 'x' });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('-')).toBeTruthy();
  });

  it('honours width and height', () => {
    render(Sparkline, { values: [1, 2], label: 'x', width: 60, height: 20 });
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('width')).toBe('60');
    expect(svg.getAttribute('height')).toBe('20');
  });
});
