import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import CreateChannelDialog from './CreateChannelDialog.svelte';
import type { NotificationChannel } from '$lib/api/notification-channels';

function webhookChannel(url: string): NotificationChannel {
  return {
    id: 'ch-1',
    organizationId: '00000000-0000-0000-0000-000000000001',
    name: 'Alerts',
    type: 'webhook',
    enabled: true,
    description: null,
    config: { url },
    createdBy: null,
    createdAt: new Date('2026-08-10T00:00:00.000Z'),
    updatedAt: new Date('2026-08-10T00:00:00.000Z'),
  } as unknown as NotificationChannel;
}

describe('CreateChannelDialog discord hint', () => {
  it('shows the discord badge for a discord webhook url', async () => {
    render(CreateChannelDialog, {
      props: {
        open: true,
        channel: webhookChannel('https://discord.com/api/webhooks/153199955952022743/token'),
      },
    });

    expect(await screen.findByText('Discord format')).toBeTruthy();
  });

  it('does not show it for another host', async () => {
    render(CreateChannelDialog, {
      props: {
        open: true,
        channel: webhookChannel('https://hooks.example.com/webhook'),
      },
    });

    await screen.findByLabelText('URL *');
    expect(screen.queryByText('Discord format')).toBeNull();
  });
});
