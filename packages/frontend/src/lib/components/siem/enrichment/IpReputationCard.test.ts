import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import IpReputationCard from './IpReputationCard.svelte';

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
