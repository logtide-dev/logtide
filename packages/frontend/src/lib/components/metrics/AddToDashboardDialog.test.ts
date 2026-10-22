import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { list, add, toast } = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/api/metrics', () => ({
  listDashboardsForPicker: list,
  addMetricPanelToDashboard: add,
}));
vi.mock('svelte-sonner', () => ({ toast }));

import AddToDashboardDialog from './AddToDashboardDialog.svelte';
import { DEFAULT_QUERY } from '$lib/utils/metrics-query';

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue([
    { id: 'd1', name: 'Ops' },
    { id: 'd2', name: 'Perf' },
  ]);
  add.mockResolvedValue(undefined);
});

function open(query = {}) {
  return render(AddToDashboardDialog, {
    open: true,
    organizationId: 'org1',
    query: { ...DEFAULT_QUERY, metric: 'cpu.usage', service: 'api', ...query },
    projectId: 'p1',
    range: '1h',
  });
}

describe('AddToDashboardDialog', () => {
  it('lists dashboards and calls addMetricPanelToDashboard with resolved config', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ops' })).toBeInTheDocument());
    await fireEvent.change(screen.getByLabelText('Dashboard'), { target: { value: 'd2' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add panel' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    const arg = add.mock.calls[0][0];
    expect(arg.organizationId).toBe('org1');
    expect(arg.dashboardId).toBe('d2');
    expect(arg.config).toMatchObject({
      type: 'metric_chart',
      metricName: 'cpu.usage',
      projectId: 'p1',
      serviceName: 'api',
      timeRange: '1h',
      interval: '1m',
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success.mock.calls[0][0]).toBe('Panel added to Perf');
  });

  it('shows dropped notice when rate selected', async () => {
    open({ aggregation: 'rate' });
    expect(screen.getByText(/Not saved to the panel yet: rate/)).toBeInTheDocument();
  });

  it('disables confirm until a dashboard is chosen', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ops' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Add panel' })).toBeDisabled();
    await fireEvent.change(screen.getByLabelText('Dashboard'), { target: { value: 'd1' } });
    expect(screen.getByRole('button', { name: 'Add panel' })).not.toBeDisabled();
  });

  it('shows an error toast and keeps the dialog open when saving fails', async () => {
    add.mockRejectedValue(new Error('boom'));
    open();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ops' })).toBeInTheDocument());
    await fireEvent.change(screen.getByLabelText('Dashboard'), { target: { value: 'd1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add panel' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('boom'));
    expect(screen.getByRole('button', { name: 'Add panel' })).toBeInTheDocument();
  });
});
