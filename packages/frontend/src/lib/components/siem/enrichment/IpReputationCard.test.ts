import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
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
