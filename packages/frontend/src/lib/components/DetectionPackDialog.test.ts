import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import type { DetectionPackWithStatus } from '@logtide/shared';

vi.mock('$lib/api/detection-packs', () => ({
  detectionPacksAPI: { enablePack: vi.fn(), disablePack: vi.fn(), updateThresholds: vi.fn() },
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

import DetectionPackDialog from './DetectionPackDialog.svelte';

function pack(over: Partial<DetectionPackWithStatus> = {}): DetectionPackWithStatus {
  return {
    id: 'startup-reliability',
    name: 'Startup reliability',
    description: 'Catches crashes and restarts',
    category: 'reliability',
    icon: 'rocket',
    rules: [
      {
        id: 'r1',
        name: 'Crash loop',
        description: 'Service restarts repeatedly',
        logsource: {},
        detection: { selection: { message: ['crash'] }, condition: 'selection' },
        level: 'high',
        status: 'stable',
        tags: [],
        references: ['https://example.com/crash-loop'],
      },
    ],
    enabled: false,
    activatedAt: null,
    customThresholds: null,
    generatedRulesCount: 0,
    ...over,
  };
}

const base = { open: true, organizationId: 'org-1' };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('DetectionPackDialog', () => {
  it('security pack dialog says Security overview and incidents', () => {
    render(DetectionPackDialog, { ...base, pack: pack({ category: 'security', name: 'Auth attacks' }) });
    const text = screen.getByTestId('pack-destination').textContent ?? '';
    expect(text).toContain('Security overview');
    expect(text).toContain('incidents');
    expect(text).not.toContain('do not create incidents');
  });

  it('reliability pack dialog says Alerts history and does not mention incidents or the Security overview', () => {
    render(DetectionPackDialog, { ...base, pack: pack({ category: 'reliability' }) });
    const text = screen.getByTestId('pack-destination').textContent ?? '';
    expect(text).toContain('Alerts history');
    expect(text).not.toContain('Security overview');
    expect(text).toContain('do not create incidents');
    expect(screen.queryByText(/SIEM Integration/i)).toBeNull();
  });

  it('non MITRE reference is labelled with its hostname', () => {
    render(DetectionPackDialog, { ...base, pack: pack() });
    expect(screen.getByRole('link', { name: 'example.com' })).toHaveAttribute(
      'href',
      'https://example.com/crash-loop',
    );
    expect(screen.queryByText('MITRE reference')).toBeNull();
  });

  it('attack.mitre.org reference is labelled MITRE reference', () => {
    const p = pack();
    p.rules[0].references = ['https://attack.mitre.org/techniques/T1110/'];
    render(DetectionPackDialog, { ...base, pack: p });
    expect(screen.getByRole('link', { name: 'MITRE reference' })).toBeInTheDocument();
  });

  it('WillNotify is rendered after the channel selector for enable', () => {
    render(DetectionPackDialog, { ...base, pack: pack() });
    const selector = screen.getByTestId('channel-selector');
    const will = screen.getByTestId('will-notify');
    expect(will).toHaveAttribute('data-event-type', 'sigma');
    expect(selector.compareDocumentPosition(will) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('uses sentence case for the actions and mentions the Detection rules page', () => {
    render(DetectionPackDialog, { ...base, pack: pack() });
    expect(screen.getByRole('button', { name: 'Enable pack' })).toBeInTheDocument();
    expect(screen.getByText('Notification settings')).toBeInTheDocument();
    expect(screen.getByText(/Detection rules page/)).toBeInTheDocument();
  });

  it('enabled pack offers Disable pack and Save changes without the channel selector', () => {
    render(DetectionPackDialog, { ...base, pack: pack({ enabled: true, generatedRulesCount: 1 }) });
    expect(screen.getByRole('button', { name: 'Disable pack' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.queryByTestId('channel-selector')).toBeNull();
  });
});
