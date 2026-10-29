import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import type { DetectionPackWithStatus } from '@logtide/shared';

const listPacks = vi.hoisted(() => vi.fn());

vi.mock('$lib/api/detection-packs', () => ({
  detectionPacksAPI: {
    listPacks,
    enablePack: vi.fn(),
    disablePack: vi.fn(),
    updateThresholds: vi.fn(),
  },
}));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('$lib/components/notification-channels', async () => ({
  ChannelSelector: (await import('./test-doubles/ChannelSelectorStub.svelte')).default,
}));
vi.mock('$lib/components/notification-channels/WillNotify.svelte', async () => ({
  default: (await import('./test-doubles/WillNotifyStub.svelte')).default,
}));

import DetectionPacksGalleryDialog from './DetectionPacksGalleryDialog.svelte';

function pack(id: string, name: string, category: DetectionPackWithStatus['category']): DetectionPackWithStatus {
  return {
    id,
    name,
    description: `${name} description`,
    category,
    icon: 'shield',
    rules: [],
    enabled: false,
    activatedAt: null,
    customThresholds: null,
    generatedRulesCount: 0,
  };
}

const PACKS = [
  pack('auth', 'Auth attacks', 'security'),
  pack('startup', 'Startup reliability', 'reliability'),
  pack('pg', 'Postgres health', 'database'),
  pack('pay', 'Payments', 'business'),
];

beforeEach(() => {
  listPacks.mockReset();
  listPacks.mockResolvedValue({ packs: PACKS });
});

afterEach(() => {
  cleanup();
});

describe('DetectionPacksGalleryDialog', () => {
  it('lists only the packs of the given categories', async () => {
    render(DetectionPacksGalleryDialog, {
      open: true,
      organizationId: 'org-1',
      categories: ['security'],
    });
    expect(await screen.findByText('Auth attacks')).toBeInTheDocument();
    expect(screen.queryByText('Startup reliability')).toBeNull();
    expect(screen.queryByText('Postgres health')).toBeNull();
    expect(screen.queryByText('Payments')).toBeNull();
  });

  it('lists every category by default', async () => {
    render(DetectionPacksGalleryDialog, { open: true, organizationId: 'org-1' });
    expect(await screen.findByText('Auth attacks')).toBeInTheDocument();
    expect(screen.getByText('Startup reliability')).toBeInTheDocument();
    expect(screen.getByText('Postgres health')).toBeInTheDocument();
    expect(screen.getByText('Payments')).toBeInTheDocument();
  });

  it('intro follows the destination of the listed categories', async () => {
    const { unmount } = render(DetectionPacksGalleryDialog, {
      open: true,
      organizationId: 'org-1',
      categories: ['security'],
    });
    await screen.findByText('Auth attacks');
    expect(screen.getByText(/Security overview/)).toBeInTheDocument();
    unmount();

    render(DetectionPacksGalleryDialog, {
      open: true,
      organizationId: 'org-1',
      categories: ['reliability', 'database', 'business'],
    });
    await screen.findByText('Startup reliability');
    expect(screen.getByText(/Alerts history/)).toBeInTheDocument();
    expect(screen.queryByText(/Security overview/)).toBeNull();
  });

  it('empty text appears when no pack matches the categories', async () => {
    listPacks.mockResolvedValue({ packs: [pack('startup', 'Startup reliability', 'reliability')] });
    render(DetectionPacksGalleryDialog, {
      open: true,
      organizationId: 'org-1',
      categories: ['security'],
    });
    expect(await screen.findByText('No detection packs available')).toBeInTheDocument();
  });
});
