import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const gotoMock = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...a: unknown[]) => gotoMock(...a) }));

const getProjects = vi.fn();
vi.mock('$lib/api/projects', () => ({
  projectsAPI: {
    getProjects: (...a: unknown[]) => getProjects(...a),
    getProjectDataAvailability: vi.fn(async () => ({ logs: [], traces: [], metrics: [] })),
  },
}));
const listDashboards = vi.fn();
vi.mock('$lib/api/custom-dashboards', () => ({
  customDashboardsAPI: { list: (...a: unknown[]) => listDashboards(...a) },
}));
const listMonitors = vi.fn();
vi.mock('$lib/api/monitoring', () => ({ listMonitors: (...a: unknown[]) => listMonitors(...a) }));
const getAlertRules = vi.fn();
vi.mock('$lib/api/alerts', () => ({ alertsAPI: { getAlertRules: (...a: unknown[]) => getAlertRules(...a) } }));

const orgProjectsState = {
  orgId: 'org-1',
  projects: [{ id: 'proj-1', name: 'Only project' }] as { id: string; name: string }[],
  withTraces: new Set<string>(),
};
const orgProjectsLoad = vi.fn(async () => {});
vi.mock('$lib/stores/org-projects', async () => {
  const { readable } = await import('svelte/store');
  return {
    orgProjectsStore: {
      subscribe: (run: (v: unknown) => void) => readable(orgProjectsState).subscribe(run),
      load: (...a: unknown[]) => orgProjectsLoad(...(a as [])),
      reset: vi.fn(),
      projectName: vi.fn(),
    },
  };
});

import CommandPalette from './CommandPalette.svelte';
import { shortcutsStore } from '$lib/stores/shortcuts';
import { organizationStore } from '$lib/stores/organization';
import { themeStore } from '$lib/stores/theme';
import { scopeStore } from '$lib/stores/scope';
import { clearPaletteCache } from '$lib/components/shell/palette/registry';

const org = (id: string, name = id) =>
  ({ id, name, slug: id, role: 'owner' }) as unknown as Parameters<typeof organizationStore.setCurrentOrganization>[0];

// jsdom lacks scrollIntoView, which the command list calls when the selection moves.
Element.prototype.scrollIntoView = vi.fn();

const TRACE_ID = 'a'.repeat(32);

function openPalette() {
  shortcutsStore.openCommandPalette();
}

beforeEach(() => {
  gotoMock.mockReset();
  getProjects.mockReset().mockResolvedValue({ projects: [] });
  listDashboards.mockReset().mockResolvedValue([]);
  listMonitors.mockReset().mockResolvedValue({ monitors: [] });
  getAlertRules.mockReset().mockResolvedValue({ alertRules: [] });
  orgProjectsLoad.mockClear();
  orgProjectsState.projects = [{ id: 'proj-1', name: 'Only project' }];
  orgProjectsState.withTraces = new Set();
  scopeStore.reset();
  clearPaletteCache();
  organizationStore.setCurrentOrganization(org('org-1'));
});

afterEach(() => {
  shortcutsStore.closeCommandPalette();
  shortcutsStore.uninstall();
  organizationStore.setCurrentOrganization(null);
});

describe('CommandPalette', () => {
  it('placeholder reads Type a command or search and headings are sentence case', async () => {
    render(CommandPalette);
    openPalette();
    expect(await screen.findByPlaceholderText('Type a command or search')).toBeInTheDocument();
    expect(await screen.findByText('Actions')).toBeInTheDocument();
    expect(screen.queryByText('Quick Actions')).toBeNull();
    expect(screen.queryByText('Quick actions')).toBeNull();
  });

  it('open trace goes straight to the trace detail', async () => {
    render(CommandPalette);
    openPalette();
    const input = await screen.findByPlaceholderText('Type a command or search');
    await fireEvent.input(input, { target: { value: TRACE_ID } });
    const row = await screen.findByText(TRACE_ID);
    await fireEvent.click(row);
    expect(gotoMock).toHaveBeenCalledWith(`/dashboard/traces/${TRACE_ID}?project=proj-1`);
  });

  it('open trace falls back to the traces list when no project can be resolved', async () => {
    orgProjectsState.projects = [
      { id: 'p1', name: 'One' },
      { id: 'p2', name: 'Two' },
    ];
    render(CommandPalette);
    openPalette();
    const input = await screen.findByPlaceholderText('Type a command or search');
    await fireEvent.input(input, { target: { value: TRACE_ID } });
    await fireEvent.click(await screen.findByText(TRACE_ID));
    expect(gotoMock).toHaveBeenCalledWith(`/dashboard/traces?traceId=${TRACE_ID}`);
  });

  it('shows no shortcut chip for combos that are not registered', async () => {
    render(CommandPalette);
    openPalette();
    await screen.findByText('Metrics');
    expect(screen.queryByText('G then M')).toBeNull();
  });

  it('shows the shortcut chip once the combo is registered', async () => {
    shortcutsStore.install();
    render(CommandPalette);
    openPalette();
    await screen.findByText('Metrics');
    expect(await screen.findByText('G then M')).toBeInTheDocument();
  });

  it('toggle theme uses the theme store', async () => {
    const spy = vi.spyOn(themeStore, 'toggle');
    const before = localStorage.getItem('logtide-theme');
    render(CommandPalette);
    openPalette();
    await fireEvent.click(await screen.findByText('Toggle theme'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('logtide-theme')).not.toBe(before);
    spy.mockRestore();
  });

  it('lists entity groups lazily after open and survives one failing provider', async () => {
    listMonitors.mockRejectedValue(new Error('500'));
    listDashboards.mockResolvedValue([{ id: 'd1', name: 'Ops board' }]);
    render(CommandPalette);

    expect(listDashboards).not.toHaveBeenCalled();
    openPalette();

    expect(await screen.findByText('Ops board')).toBeInTheDocument();
    const headings = Array.from(document.querySelectorAll('[data-command-group-heading]')).map((h) => h.textContent);
    expect(headings).toContain('Dashboards');
    expect(headings).not.toContain('Monitors');
    // The rest of the palette stays usable
    expect(screen.getByText('Toggle theme')).toBeInTheDocument();
  });

  it('does not load entity data before the palette opens', async () => {
    render(CommandPalette);
    await Promise.resolve();
    expect(getProjects).not.toHaveBeenCalled();
    expect(listDashboards).not.toHaveBeenCalled();
    expect(listMonitors).not.toHaveBeenCalled();
    expect(getAlertRules).not.toHaveBeenCalled();
  });

  it('reloads after the organization changes and drops old items', async () => {
    listDashboards.mockImplementation(async (orgId: string) =>
      orgId === 'org-1' ? [{ id: 'd1', name: 'Org one board' }] : [{ id: 'd2', name: 'Org two board' }]
    );
    render(CommandPalette);
    openPalette();
    expect(await screen.findByText('Org one board')).toBeInTheDocument();

    organizationStore.setCurrentOrganization(org('org-2'));

    expect(await screen.findByText('Org two board')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Org one board')).toBeNull());
  });

  it('search group offers logs and errors with the typed text', async () => {
    render(CommandPalette);
    openPalette();
    const input = await screen.findByPlaceholderText('Type a command or search');
    await fireEvent.input(input, { target: { value: 'timeout error' } });

    await fireEvent.click(await screen.findByText('Search logs for "timeout error"'));
    expect(gotoMock).toHaveBeenCalledWith('/dashboard/logs?q=timeout%20error');

    gotoMock.mockReset();
    openPalette();
    const input2 = await screen.findByPlaceholderText('Type a command or search');
    await fireEvent.input(input2, { target: { value: 'timeout error' } });
    await fireEvent.click(await screen.findByText('Search errors for "timeout error"'));
    expect(gotoMock).toHaveBeenCalledWith('/dashboard/errors?search=timeout%20error');
  });
});
