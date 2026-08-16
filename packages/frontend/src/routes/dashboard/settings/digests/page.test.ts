import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { getConfig, saveConfig, addRecipient, removeRecipient, resubscribeRecipient } = vi.hoisted(
  () => ({
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
    addRecipient: vi.fn(),
    removeRecipient: vi.fn(),
    resubscribeRecipient: vi.fn(),
  })
);

vi.mock('$lib/api/digests', () => ({
  digestsAPI: { getConfig, saveConfig, addRecipient, removeRecipient, resubscribeRecipient },
}));

import Page from './+page.svelte';
import { authStore } from '$lib/stores/auth';
import { organizationStore } from '$lib/stores/organization';
import { DIGEST_SECTION_KEYS, DIGEST_SECTION_DEFAULTS, mergeDigestSections } from '@logtide/shared';

const baseOrg = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  ownerId: 'user-1',
  role: 'owner' as const,
  retentionDays: 90,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

// The API always returns the MERGED record, so the page never has to resolve
// defaults itself; here traces is the one section turned on by the operator.
function serverConfig(sections: Record<string, boolean> = mergeDigestSections({ traces: true })) {
  return {
    id: 'cfg-1',
    frequency: 'daily' as const,
    delivery_hour: 8,
    delivery_day_of_week: null,
    enabled: true,
    last_sent_at: null,
    sections,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

const SECTION_LABELS: Array<[(typeof DIGEST_SECTION_KEYS)[number], string]> = [
  ['logVolume', 'Log volume'],
  ['topErrorServices', 'Top services by errors'],
  ['newErrorGroups', 'New error groups'],
  ['security', 'Security'],
  ['uptime', 'Uptime'],
  ['logBreakdown', 'Log level breakdown'],
  ['topErrorMessages', 'Top error messages'],
  ['traces', 'Traces'],
  ['metrics', 'Metrics'],
  ['alerts', 'Alerts'],
  ['securityActivity', 'Security activity'],
  ['monitorPerformance', 'Monitor performance'],
  ['usage', 'Usage'],
  ['webhooks', 'Webhook deliveries'],
  ['teamActivity', 'Team activity'],
];

function sectionSwitch(label: string): HTMLElement {
  return screen.getByRole('switch', { name: label });
}

describe('digest sections card', () => {
  beforeEach(() => {
    localStorage.clear();
    getConfig.mockReset();
    saveConfig.mockReset();
    authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
    organizationStore.clear();
    getConfig.mockResolvedValue({ config: serverConfig(), recipients: [] });
    saveConfig.mockResolvedValue(serverConfig());
  });

  it('renders one switch per catalog section', async () => {
    organizationStore.setCurrentOrganization({ ...baseOrg });

    render(Page);
    await screen.findByText('Sections');

    for (const [, label] of SECTION_LABELS) {
      expect(sectionSwitch(label)).toBeInTheDocument();
    }
    // 15 sections plus the "Enable digest emails" switch on the Schedule card.
    expect(screen.getAllByRole('switch')).toHaveLength(DIGEST_SECTION_KEYS.length + 1);
  });

  it('reflects the merged sections returned by the API', async () => {
    organizationStore.setCurrentOrganization({ ...baseOrg });

    render(Page);
    await screen.findByText('Sections');

    // The five original sections stay on by default.
    for (const label of [
      'Log volume',
      'Top services by errors',
      'New error groups',
      'Security',
      'Uptime',
    ]) {
      expect(sectionSwitch(label)).toHaveAttribute('aria-checked', 'true');
    }
    // Enabled by the stored partial.
    expect(sectionSwitch('Traces')).toHaveAttribute('aria-checked', 'true');
    // Still off: a default-off section nobody enabled.
    expect(sectionSwitch('Team activity')).toHaveAttribute('aria-checked', 'false');
  });

  it('falls back to the defaults when no config exists yet', async () => {
    getConfig.mockResolvedValue({ config: null, recipients: [] });
    organizationStore.setCurrentOrganization({ ...baseOrg });

    render(Page);
    await screen.findByText('Sections');

    for (const [key, label] of SECTION_LABELS) {
      expect(sectionSwitch(label)).toHaveAttribute(
        'aria-checked',
        String(DIGEST_SECTION_DEFAULTS[key])
      );
    }
  });

  // Binding ruling: only keys that DIFFER from the shared defaults are sent, so
  // a future change to the defaults still propagates to saved organizations.
  it('saves only the sections that differ from the defaults', async () => {
    organizationStore.setCurrentOrganization({ ...baseOrg });

    render(Page);
    await screen.findByText('Sections');

    await fireEvent.click(sectionSwitch('Team activity'));
    await fireEvent.click(sectionSwitch('Log volume'));
    await fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));

    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(saveConfig.mock.calls[0][1].sections).toEqual({
      traces: true,
      teamActivity: true,
      logVolume: false,
    });
  });

  it('sends an empty sections object when nothing differs from the defaults', async () => {
    getConfig.mockResolvedValue({ config: serverConfig(mergeDigestSections(null)), recipients: [] });
    organizationStore.setCurrentOrganization({ ...baseOrg });

    render(Page);
    await screen.findByText('Sections');

    await fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));

    expect(saveConfig.mock.calls[0][1].sections).toEqual({});
  });
});
