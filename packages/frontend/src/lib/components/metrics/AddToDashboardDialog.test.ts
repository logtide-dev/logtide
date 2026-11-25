import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { list, add, create, toast } = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  create: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/api/custom-dashboards', () => ({
  customDashboardsAPI: { list, addPanel: add, create },
}));
vi.mock('svelte-sonner', () => ({ toast }));

import type { MetricExplorerQuery } from '@logtide/shared';
import { chooseSelectOption } from '$lib/test-utils/select-field';
import AddToDashboardDialog from './AddToDashboardDialog.svelte';

const query: MetricExplorerQuery = {
  projectIds: ['p1'],
  queries: [
    {
      id: 'A',
      metricName: 'system.cpu.utilization',
      aggregation: 'avg',
      filters: [],
      groupBy: [{ scope: 'resource', key: 'host.name' }],
    },
  ],
  formulas: [],
  interval: 'auto',
  compareTo: 'none',
  display: 'split',
};

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue([
    { id: 'd1', name: 'Ops' },
    { id: 'd2', name: 'Perf' },
  ]);
  add.mockResolvedValue({ dashboard: {}, panel: {} });
  create.mockResolvedValue({ id: 'new1', name: 'Infra' });
});

function open(range: { kind: 'preset'; preset: '1h' | '24h' } | { kind: 'custom'; from: string; to: string } = { kind: 'preset', preset: '1h' }) {
  return render(AddToDashboardDialog, { open: true, organizationId: 'org1', query, range });
}

describe('AddToDashboardDialog', () => {
  it('saves the query as a metrics panel on the chosen dashboard', async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText('Dashboard')).not.toBeDisabled());
    expect(screen.getByLabelText('Panel title')).toHaveValue('system.cpu.utilization');
    await chooseSelectOption(screen.getByLabelText('Dashboard'), 'Perf');
    await fireEvent.click(screen.getByRole('button', { name: 'Add panel' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    const [id, org, config] = add.mock.calls[0];
    expect(id).toBe('d2');
    expect(org).toBe('org1');
    expect(config).toMatchObject({
      type: 'metrics',
      source: 'metrics',
      title: 'system.cpu.utilization',
      timeRange: '1h',
      query,
    });
    expect(create).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success.mock.calls[0][0]).toBe('Panel added to Perf');
  });

  it('maps a custom range to the closest preset', async () => {
    const from = new Date('2026-01-01T00:00:00Z');
    open({ kind: 'custom', from: from.toISOString(), to: new Date(from.getTime() + 5 * 3600_000).toISOString() });
    await waitFor(() => expect(screen.getByLabelText('Dashboard')).not.toBeDisabled());
    await chooseSelectOption(screen.getByLabelText('Dashboard'), 'Ops');
    await fireEvent.click(screen.getByRole('button', { name: 'Add panel' }));
    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(add.mock.calls[0][2].timeRange).toBe('6h');
  });

  it('creates a new dashboard and adds the panel to it', async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText('Dashboard')).not.toBeDisabled());
    await chooseSelectOption(screen.getByLabelText('Dashboard'), 'New dashboard');
    expect(screen.getByRole('button', { name: 'Add panel' })).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('Dashboard name'), { target: { value: 'Infra' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add panel' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({ organizationId: 'org1', name: 'Infra', panels: [] });
    expect(add.mock.calls[0][0]).toBe('new1');
  });

  it('disables confirm until a dashboard is chosen', async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText('Dashboard')).not.toBeDisabled());
    expect(screen.getByRole('button', { name: 'Add panel' })).toBeDisabled();
    await chooseSelectOption(screen.getByLabelText('Dashboard'), 'Ops');
    expect(screen.getByRole('button', { name: 'Add panel' })).not.toBeDisabled();
  });

  it('shows an error toast and keeps the dialog open when saving fails', async () => {
    add.mockRejectedValue(new Error('boom'));
    open();
    await waitFor(() => expect(screen.getByLabelText('Dashboard')).not.toBeDisabled());
    await chooseSelectOption(screen.getByLabelText('Dashboard'), 'Ops');
    await fireEvent.click(screen.getByRole('button', { name: 'Add panel' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('boom'));
    expect(screen.getByRole('button', { name: 'Add panel' })).toBeInTheDocument();
  });
});
