import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { getProjects } = vi.hoisted(() => ({ getProjects: vi.fn() }));
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = getProjects;
  },
}));

import LogTableConfigForm from './LogTableConfigForm.svelte';
import type { LogTableConfig } from '@logtide/shared';

function config(overrides: Partial<LogTableConfig> = {}): LogTableConfig {
  return {
    type: 'log_table',
    title: 'WAN hits',
    source: 'logs',
    projectId: null,
    mode: 'snapshot',
    timeRange: '1h',
    levels: [],
    service: null,
    maxRows: 25,
    columns: ['http_host'],
    builtinColumns: ['time', 'level', 'service', 'message'],
    wrapCells: false,
    ...overrides,
  };
}

beforeEach(() => {
  getProjects.mockReset();
  getProjects.mockResolvedValue({ projects: [{ id: 'proj-1', name: 'Edge' }] });
});

describe('LogTableConfigForm', () => {
  it('adds a metadata column', async () => {
    const onChange = vi.fn();
    render(LogTableConfigForm, { props: { config: config(), onChange } });

    const input = screen.getByPlaceholderText('e.g. http_host or geo.city');
    await fireEvent.input(input, { target: { value: 'client_ip' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add column' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ columns: ['http_host', 'client_ip'] })
    );
  });

  it('removes a column', async () => {
    const onChange = vi.fn();
    render(LogTableConfigForm, { props: { config: config(), onChange } });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove http_host' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ columns: [] }));
  });

  it('reorders columns', async () => {
    const onChange = vi.fn();
    render(LogTableConfigForm, {
      props: { config: config({ columns: ['a', 'b'] }), onChange },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Move b up' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ columns: ['b', 'a'] }));
  });

  it('disables adding beyond 10 columns', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `c${i}`);
    render(LogTableConfigForm, {
      props: { config: config({ columns: ten }), onChange: vi.fn() },
    });

    const addButton = screen.getByRole('button', { name: 'Add column' });
    expect((addButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('toggles built-in columns', async () => {
    const onChange = vi.fn();
    render(LogTableConfigForm, { props: { config: config(), onChange } });

    await fireEvent.click(screen.getByRole('button', { name: 'Toggle Service column' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ builtinColumns: ['time', 'level', 'message'] })
    );
  });

  it('warns when live mode has no project selected', () => {
    render(LogTableConfigForm, {
      props: { config: config({ mode: 'live', projectId: null }), onChange: vi.fn() },
    });
    expect(screen.getByText('Live mode requires a specific project')).toBeInTheDocument();
  });
});
