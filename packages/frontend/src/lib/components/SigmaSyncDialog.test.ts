import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

const api = vi.hoisted(() => ({
  getCategoryTree: vi.fn(),
  getRulesForCategory: vi.fn(),
  searchRules: vi.fn(),
  syncFromSigmaHQ: vi.fn(),
  updateRule: vi.fn(),
  getSigmaRuleChannels: vi.fn(),
}));

vi.mock('$lib/api/sigma', () => ({
  sigmaAPI: {
    getCategoryTree: api.getCategoryTree,
    getRulesForCategory: api.getRulesForCategory,
    searchRules: api.searchRules,
    syncFromSigmaHQ: api.syncFromSigmaHQ,
    updateRule: api.updateRule,
  },
}));
vi.mock('$lib/api/notification-channels', () => ({
  notificationChannelsAPI: { getSigmaRuleChannels: api.getSigmaRuleChannels },
}));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('$lib/stores/checklist', () => ({ checklistStore: { completeItem: vi.fn() } }));
vi.mock('$lib/components/notification-channels', async () => ({
  ChannelSelector: (await import('./test-doubles/ChannelSelectorStub.svelte')).default,
}));
vi.mock('$lib/components/notification-channels/WillNotify.svelte', async () => ({
  default: (await import('./test-doubles/WillNotifyStub.svelte')).default,
}));

import SigmaSyncDialog from './SigmaSyncDialog.svelte';
import SigmaTreeMultiSelect from './SigmaTreeMultiSelect.svelte';
import EditSigmaChannelsDialog from './EditSigmaChannelsDialog.svelte';
import { organizationStore } from '$lib/stores/organization';

beforeEach(() => {
  vi.clearAllMocks();
  api.getCategoryTree.mockResolvedValue({
    tree: [{ name: 'windows', path: 'rules/windows', type: 'category', ruleCount: 12 }],
  });
  api.getRulesForCategory.mockResolvedValue({ rules: [] });
  api.getSigmaRuleChannels.mockResolvedValue([]);
  organizationStore.setCurrentOrganization({
    id: 'org-1',
    name: 'Acme',
    slug: 'acme',
    ownerId: 'u1',
    role: 'owner',
    retentionDays: 90,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
});

afterEach(() => {
  cleanup();
});

describe('SigmaSyncDialog', () => {
  it('uses sentence case for the select rules label', async () => {
    render(SigmaSyncDialog, { open: true, organizationId: 'org-1' });
    expect(await screen.findByText('Select rules to import')).toBeTruthy();
    expect(screen.queryByText('Select Rules to Import')).toBeNull();
    expect(screen.getByText('Notification settings (optional)')).toBeTruthy();
  });
});

describe('SigmaTreeMultiSelect', () => {
  it('expand buttons and checkboxes have aria-labels', async () => {
    render(SigmaTreeMultiSelect, { onSelectionChange: vi.fn() });
    const expand = await screen.findByRole('button', { name: 'Expand windows' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('checkbox', { name: 'Select category windows' })).toBeTruthy();
    await fireEvent.click(expand);
    expect(await screen.findByRole('button', { name: 'Collapse windows' })).toBeTruthy();
  });
});

describe('EditSigmaChannelsDialog', () => {
  it('renders the routing preview for sigma', async () => {
    const rule = { id: 'rule-1', title: 'Brute force', level: 'high' } as never;
    render(EditSigmaChannelsDialog, { open: true, rule });
    const line = await screen.findByTestId('will-notify');
    expect(line.getAttribute('data-event-type')).toBe('sigma');
    expect(screen.getByText('Edit destinations')).toBeTruthy();
  });
});
