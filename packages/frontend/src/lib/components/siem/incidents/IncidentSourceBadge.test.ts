import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import IncidentSourceBadge from './IncidentSourceBadge.svelte';

describe('IncidentSourceBadge', () => {
  it.each([
    ['sigma', 'Security'],
    ['alert', 'Alert'],
    ['monitor', 'Uptime'],
    ['manual', 'Manual'],
  ])('renders %s as %s', (source, label) => {
    const { getByText } = render(IncidentSourceBadge, { props: { source } });
    expect(getByText(label)).toBeTruthy();
  });

  it('renders neutral raw text for an unknown source', () => {
    const { getByText } = render(IncidentSourceBadge, { props: { source: 'future_source' } });
    const el = getByText('future_source');
    expect(el.className).toContain('bg-secondary');
  });
});
