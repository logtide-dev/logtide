import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DestinationTypeIcon from './DestinationTypeIcon.svelte';

describe('DestinationTypeIcon', () => {
  it('renders an accessible label for slack', () => {
    render(DestinationTypeIcon, { props: { type: 'slack' } });
    expect(screen.getByLabelText('Slack')).toBeTruthy();
  });

  it('labels every type', () => {
    const labels: Record<string, string> = {
      email: 'Email',
      webhook: 'Webhook',
      teams: 'Microsoft Teams',
      discord: 'Discord',
      pagerduty: 'PagerDuty',
    };
    for (const [type, label] of Object.entries(labels)) {
      const { unmount } = render(DestinationTypeIcon, { props: { type: type as never } });
      expect(screen.getByLabelText(label)).toBeTruthy();
      unmount();
    }
  });
});
