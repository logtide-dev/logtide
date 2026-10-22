import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import IpReputationCard from './IpReputationCard.svelte';
import { displayPreferences } from '$lib/stores/display-preferences';
import { formatDateShort } from '$lib/utils/datetime';

describe('IpReputationCard last checked', () => {
  beforeEach(() => {
    // Far ahead of the browser zone, so a browser-zone date cannot match by luck.
    displayPreferences.set({ hour12: false, timeZone: 'Pacific/Kiritimati' });
  });

  it('shows an old check as a date in the display zone', async () => {
    const day = new Date(Date.now() - 60 * 86_400_000);
    day.setUTCHours(20, 0, 0, 0);
    const lastChecked = day.toISOString();
    const { getByRole, container } = render(IpReputationCard, {
      props: {
        ipReputation: {
          '203.0.113.9': { ip: '203.0.113.9', reputation: 'clean', source: 'abuseipdb', lastChecked },
        },
      },
    });
    await fireEvent.click(getByRole('button', { expanded: false }));
    const text = container.textContent ?? '';
    expect(text).toContain(formatDateShort(lastChecked));
    expect(text).not.toContain(day.toLocaleDateString('en-US'));
  });
});

const entry = (reputation: 'clean' | 'suspicious' | 'malicious', abuseConfidenceScore: number) => ({
  ip: '203.0.113.7',
  reputation,
  abuseConfidenceScore,
  source: 'test',
  lastChecked: '2026-10-22T10:00:00.000Z',
});

describe('IpReputationCard colours', () => {
  it('malicious badge uses the destructive token with a dark variant', () => {
    render(IpReputationCard, { props: { ipReputation: { a: entry('malicious', 95) } } });
    const badge = screen.getByText('Malicious').closest('[data-slot="badge"], div, span') as HTMLElement;
    expect(badge.className).toContain('bg-destructive/15');
    expect(badge.className).toContain('text-destructive-text');
    expect(badge.className).not.toMatch(/red-\d/);
  });

  it('clean badge uses the success token, not raw green classes', () => {
    render(IpReputationCard, { props: { ipReputation: { a: entry('clean', 0) } } });
    const badge = screen.getByText('Clean').closest('[data-slot="badge"], div, span') as HTMLElement;
    expect(badge.className).toContain('bg-success/15');
    expect(badge.className).not.toMatch(/green-\d/);
  });

  it('score bar uses semantic tokens for the high-score band', () => {
    const { container } = render(IpReputationCard, {
      props: { ipReputation: { a: entry('malicious', 80) } },
    });
    const bar = container.querySelector('div.h-full.rounded-full') as HTMLElement;
    expect(bar.className).toContain('bg-destructive');
    expect(bar.className).not.toMatch(/-(red|green|yellow)-500/);
  });
});
