import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import SeverityBadge from './SeverityBadge.svelte';

describe('SeverityBadge', () => {
  it('shows an investigating state as Acknowledged in the amber tone', () => {
    render(SeverityBadge, { kind: 'state', value: 'investigating' });
    const el = screen.getByTestId('severity-badge');
    expect(el.textContent?.trim()).toBe('Acknowledged');
    expect(el.className).toContain('warning');
  });

  it('labels a level case-insensitively', () => {
    render(SeverityBadge, { kind: 'level', value: 'WARNING' });
    expect(screen.getByTestId('severity-badge').textContent?.trim()).toBe('Warning');
  });

  it('falls back to a neutral tone for unknown values', () => {
    render(SeverityBadge, { kind: 'state', value: 'zzz' });
    const el = screen.getByTestId('severity-badge');
    expect(el.textContent?.trim()).toBe('Zzz');
    expect(el.className).toContain('bg-secondary');
  });

  it('shows Unknown for an empty value', () => {
    render(SeverityBadge, { kind: 'severity', value: '' });
    expect(screen.getByTestId('severity-badge').textContent?.trim()).toBe('Unknown');
  });

  it('hides the dot from assistive tech', () => {
    const { container } = render(SeverityBadge, { kind: 'severity', value: 'high' });
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
