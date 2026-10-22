import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  getRules: vi.fn(),
  getHistory: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  snooze: vi.fn(),
  unsnooze: vi.fn(),
  detections: vi.fn(),
  getProjects: vi.fn(),
  channels: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/components/app/ScopeBar.svelte', async () => ({
  default: (await import('../../../test-stubs/ScopeBar.stub.svelte')).default,
}));
vi.mock('$lib/components/CreateAlertDialog.svelte', async () => ({
  default: (await import('../../../test-stubs/CreateAlertDialog.stub.svelte')).default,
}));
vi.mock('$lib/components/EditAlertDialog.svelte', async () => ({
  default: (await import('../../../test-stubs/EditAlertDialog.stub.svelte')).default,
}));
vi.mock('$lib/components/DetectionPacksGalleryDialog.svelte', async () => ({
  default: (await import('../../../test-stubs/DetectionPacksGalleryDialog.stub.svelte')).default,
}));
vi.mock('$lib/api/alerts', () => ({
  alertsAPI: {
    getAlertRules: h.getRules,
    getAlertHistory: h.getHistory,
    updateAlertRule: h.update,
    deleteAlertRule: h.remove,
    snoozeAlertRule: h.snooze,
    unsnoozeAlertRule: h.unsnooze,
  },
}));
vi.mock('$lib/api/siem', () => ({ getRecentDetections: h.detections }));
vi.mock('$lib/api/projects', () => ({ projectsAPI: { getProjects: h.getProjects } }));
vi.mock('$lib/api/notification-channels', () => ({
  notificationChannelsAPI: { list: h.channels },
}));
vi.mock('$lib/api/notification-routing', () => ({
  notificationRoutingAPI: { preview: vi.fn().mockResolvedValue({ destinations: [], fallback: false }) },
}));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: h.success, error: h.error, warning: vi.fn(), info: vi.fn() },
}));

import AlertsWorkspace from './AlertsWorkspace.svelte';
import { page } from '$app/state';
import { organizationStore } from '$lib/stores/organization';
import { scopeStore } from '$lib/stores/scope';

const org = (id: string) => ({
  id,
  name: id,
  slug: id,
  ownerId: 'u1',
  role: 'owner' as const,
  retentionDays: 90,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
});

function rule(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: 'org-1',
    projectId: null,
    name: `Rule ${id}`,
    enabled: true,
    service: null,
    level: ['error'],
    threshold: 10,
    timeWindow: 5,
    alertType: 'threshold',
    baselineType: null,
    deviationMultiplier: null,
    minBaselineValue: null,
    cooldownMinutes: null,
    sustainedMinutes: null,
    emailRecipients: [],
    webhookUrl: null,
    channelIds: ['c1'],
    metadataFilters: [],
    query: null,
    state: 'ok',
    lastTriggeredAt: null,
    lastEvaluatedAt: null,
    snoozedUntil: null,
    renotifyMinutes: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

function historyRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    ruleId: 'r1',
    ruleName: 'Rule r1',
    projectId: null,
    projectName: null,
    triggeredAt: '2026-10-02T10:00:00Z',
    logCount: 12,
    notified: true,
    error: null,
    threshold: 10,
    timeWindow: 5,
    service: null,
    level: ['error'],
    alertType: 'threshold',
    baselineMetadata: null,
    ...over,
  };
}

function setUrl(qs = '', path = '/dashboard/alerts') {
  (page as { url: URL }).url = new URL(`http://localhost${path}${qs}`);
}

function mount(props: Record<string, unknown> = {}) {
  return render(AlertsWorkspace, { props });
}

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  h.getRules.mockResolvedValue({
    alertRules: [
      rule('org-wide'),
      rule('p1-rule', { projectId: 'p1' }),
      rule('p2-rule', { projectId: 'p2' }),
    ],
  });
  h.getHistory.mockResolvedValue({ history: [historyRow('h1')], total: 1 });
  h.detections.mockResolvedValue({ detections: [] });
  h.getProjects.mockResolvedValue({
    projects: [
      { id: 'p1', name: 'Web' },
      { id: 'p2', name: 'Api' },
    ],
  });
  h.channels.mockResolvedValue([{ id: 'c1', name: '#ops', type: 'slack' }]);
  h.goto.mockResolvedValue(undefined);
  setUrl();
  scopeStore.reset();
  organizationStore.clear();
  organizationStore.setCurrentOrganization(org('org-1'));
});

afterEach(() => cleanup());

describe('AlertsWorkspace', () => {
  it('global page lists rules from all projects and filters by scope project plus org-wide', async () => {
    mount();
    expect(await screen.findByText('Rule p1-rule')).toBeTruthy();
    expect(screen.getByText('Rule p2-rule')).toBeTruthy();
    expect(screen.getByText('Rule org-wide')).toBeTruthy();
    expect(screen.getByTestId('scope-bar')).toBeTruthy();

    cleanup();
    setUrl('?project=p1');
    mount();
    expect(await screen.findByText('Rule p1-rule')).toBeTruthy();
    expect(screen.queryByText('Rule p2-rule')).toBeNull();
    expect(screen.getByText('Rule org-wide')).toBeTruthy();
  });

  it("project tab shows only that project's rules and org-wide rules, no Sigma tab, no ScopeBar", async () => {
    setUrl('', '/dashboard/projects/p1/alerts');
    mount({ embedded: true, lockedProjectId: 'p1' });
    expect(await screen.findByText('Rule p1-rule')).toBeTruthy();
    expect(screen.getByText('Rule org-wide')).toBeTruthy();
    expect(screen.queryByText('Rule p2-rule')).toBeNull();
    expect(screen.queryByTestId('scope-bar')).toBeNull();
    expect(screen.queryByText(/sigma/i)).toBeNull();
    expect(screen.getByRole('link', { name: /security > rules/i }).getAttribute('href')).toBe(
      '/dashboard/security/rules'
    );
  });

  it('asks the server for one project when exactly one is in scope, and pages with it', async () => {
    setUrl('', '/dashboard/projects/p1/alerts');
    mount({ embedded: true, lockedProjectId: 'p1' });
    await screen.findByText('Rule p1-rule');
    expect(h.getHistory).toHaveBeenCalledWith('org-1', expect.objectContaining({ projectId: 'p1' }));
    expect(h.detections).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));

    cleanup();
    h.getHistory.mockClear();
    h.detections.mockClear();
    setUrl('?project=p2');
    mount();
    await screen.findByText('Rule p2-rule');
    expect(h.getHistory).toHaveBeenCalledWith('org-1', expect.objectContaining({ projectId: 'p2' }));

    cleanup();
    h.getHistory.mockClear();
    setUrl();
    mount();
    await screen.findByText('Rule p2-rule');
    expect(h.getHistory.mock.calls[0][1].projectId).toBeUndefined();
  });

  it('?create=1 with prefill opens Create prefilled and strips the params', async () => {
    setUrl('?create=1&projectId=p&query=x&levels=error,critical&service=api&name=n&keep=1');
    mount();
    const dialog = await screen.findByTestId('create-dialog');
    expect(dialog).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('create-prefill').textContent ?? '')).toEqual({
      projectId: 'p',
      query: 'x',
      levels: ['error', 'critical'],
      service: 'api',
      name: 'n',
    });
    expect(h.goto).toHaveBeenCalledTimes(1);
    const [target, opts] = h.goto.mock.calls[0];
    expect(target).toBe('/dashboard/alerts?keep=1');
    expect(opts.replaceState).toBe(true);
  });

  it('legacy ?new=1 still opens Create', async () => {
    setUrl('?new=1&name=legacy');
    mount();
    expect(await screen.findByTestId('create-dialog')).toBeTruthy();
    expect(screen.getByTestId('create-prefill').textContent).toContain('legacy');
  });

  it('?edit=<id> opens Edit for that rule', async () => {
    setUrl('?edit=p1-rule');
    mount();
    const dialog = await screen.findByTestId('edit-dialog');
    expect(dialog.getAttribute('data-rule')).toBe('p1-rule');
    expect(h.goto).toHaveBeenCalled();
  });

  it('?edit with an unknown id toasts and opens nothing', async () => {
    setUrl('?edit=nope');
    mount();
    await waitFor(() => expect(h.error).toHaveBeenCalledWith('Alert rule not found'));
    expect(screen.queryByTestId('edit-dialog')).toBeNull();
  });

  it('?rule=<id> highlights that rule row, scrolls to it and keeps the param', async () => {
    const scroll = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = scroll;
    setUrl('?rule=p1-rule');
    mount();
    const cell = await screen.findByText('Rule p1-rule');
    const row = cell.closest('tr')!;
    await waitFor(() => expect(row.getAttribute('data-state')).toBe('selected'));
    expect(screen.getByText('Rule p2-rule').closest('tr')!.getAttribute('data-state')).toBeNull();
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(h.goto).not.toHaveBeenCalled();
  });

  it('?rule= with an unknown id highlights nothing', async () => {
    setUrl('?rule=nope');
    mount();
    const cell = await screen.findByText('Rule p1-rule');
    expect(cell.closest('tr')!.getAttribute('data-state')).toBeNull();
    expect(document.querySelector('tr[data-state="selected"]')).toBeNull();
  });

  it('Detection packs opens the gallery with the reliability, database and business categories', async () => {
    mount();
    await screen.findByText('Rule p1-rule');
    expect(screen.queryByTestId('packs-dialog')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Detection packs' }));
    const dialog = await screen.findByTestId('packs-dialog');
    expect(dialog.getAttribute('data-categories')).toBe('reliability,database,business');
  });

  it('toggle patches one row without reloading', async () => {
    h.update.mockResolvedValue({ alertRule: rule('org-wide', { enabled: false }) });
    mount();
    await screen.findByText('Rule org-wide');
    const switches = screen.getAllByRole('switch');
    await fireEvent.click(switches[0]);
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('org-1', 'org-wide', { enabled: false }));
    await waitFor(() => expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('false'));
    expect(h.getRules).toHaveBeenCalledTimes(1);
  });

  it('snooze calls snoozeAlertRule with an ISO time and shows state Snoozed', async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    h.snooze.mockImplementation(async (_o: string, id: string, u: string) => ({
      alertRule: rule(id, { snoozedUntil: u }),
    }));
    mount();
    await screen.findByText('Rule org-wide');
    const triggers = screen.getAllByRole('button', { name: 'Snooze alert' });
    await fireEvent.click(triggers[0]);
    const item = await screen.findByText('Snooze for 1 hour');
    await fireEvent.click(item);
    await waitFor(() => expect(h.snooze).toHaveBeenCalled());
    const [orgArg, idArg, iso] = h.snooze.mock.calls[0];
    expect(orgArg).toBe('org-1');
    expect(idArg).toBe('org-wide');
    expect(new Date(iso).toISOString()).toBe(iso);
    expect(Math.abs(new Date(iso).getTime() - new Date(until).getTime())).toBeLessThan(60_000);
    expect(await screen.findByText('Snoozed')).toBeTruthy();
  });

  it('delete requires confirming in the ConfirmDialog and Cancel does not delete', async () => {
    h.remove.mockResolvedValue(undefined);
    mount();
    await screen.findByText('Rule org-wide');
    await fireEvent.click(screen.getAllByRole('button', { name: /delete/i })[0]);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete alert rule')).toBeTruthy();
    expect(within(dialog).getByText(/Rule org-wide/)).toBeTruthy();
    // Focus lands on Cancel, so a stray Enter cannot delete.
    await waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Cancel'));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(h.remove).not.toHaveBeenCalled();

    await fireEvent.click(screen.getAllByRole('button', { name: /delete/i })[0]);
    const again = await screen.findByRole('alertdialog');
    await fireEvent.click(within(again).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith('org-wide', 'org-1'));
    await waitFor(() => expect(screen.queryByText('Rule org-wide')).toBeNull());
  });

  it('delete failure toasts the error and keeps the row', async () => {
    h.remove.mockRejectedValue(new Error('Boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount();
    await screen.findByText('Rule org-wide');
    await fireEvent.click(screen.getAllByRole('button', { name: /delete/i })[0]);
    const dialog = await screen.findByRole('alertdialog');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith('Boom'));
    expect(screen.getByText('Rule org-wide')).toBeTruthy();
    spy.mockRestore();
  });

  it('history tab renders AlertHistoryTable with detections', async () => {
    h.detections.mockResolvedValue({
      detections: [
        {
          id: 'd1',
          time: '2026-10-03T10:00:00Z',
          organizationId: 'org-1',
          projectId: null,
          sigmaRuleId: 's1',
          logId: 'l1',
          severity: 'high',
          ruleTitle: 'Slow queries detected',
          ruleDescription: null,
          category: 'database',
          service: 'db',
          traceId: null,
          matchedFields: null,
        },
      ],
    });
    mount();
    await screen.findByText('Rule org-wide');
    const tab = screen.getByRole('tab', { name: 'History' });
    await fireEvent.mouseDown(tab);
    await fireEvent.click(tab);
    await waitFor(() => expect(screen.getByText('Slow queries detected')).toBeTruthy());
    expect(h.detections.mock.calls[0][0].category).toEqual(['reliability', 'database', 'business']);
  });

  it('fetch error shows EmptyState error with Retry', async () => {
    h.getRules.mockRejectedValueOnce(new Error('Server down'));
    mount();
    expect(await screen.findByText('Could not load alert rules')).toBeTruthy();
    expect(screen.getByText('Server down')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Rule org-wide')).toBeTruthy();
  });

  it('org with zero projects still renders org-wide rules', async () => {
    h.getProjects.mockResolvedValue({ projects: [] });
    h.getRules.mockResolvedValue({ alertRules: [rule('org-wide')] });
    mount();
    expect(await screen.findByText('Rule org-wide')).toBeTruthy();
  });

  it('no rules shows the empty state with Create alert and a link to Security rules', async () => {
    h.getRules.mockResolvedValue({ alertRules: [] });
    mount();
    expect(await screen.findByText('No alert rules')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Create alert' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Open detection rules' }).getAttribute('href')).toBe(
      '/dashboard/security/rules'
    );
  });

  it('a stale response from the previous org is ignored', async () => {
    let releaseFirst: (v: unknown) => void = () => {};
    h.getRules
      .mockImplementationOnce(() => new Promise((r) => (releaseFirst = r)))
      .mockResolvedValueOnce({ alertRules: [rule('fresh', { organizationId: 'org-2' })] });
    mount();
    await waitFor(() => expect(h.getRules).toHaveBeenCalledTimes(1));
    organizationStore.setCurrentOrganization(org('org-2'));
    expect(await screen.findByText('Rule fresh')).toBeTruthy();
    releaseFirst({ alertRules: [rule('stale')] });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Rule stale')).toBeNull();
    expect(screen.getByText('Rule fresh')).toBeTruthy();
  });
});
