import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  getLogs: vi.fn(),
  getProjects: vi.fn(),
  preview: vi.fn(),
}));

vi.mock('$lib/api/logs', () => ({ logsAPI: { getLogs: h.getLogs } }));
vi.mock('$lib/api/projects', () => ({ projectsAPI: { getProjects: h.getProjects } }));
vi.mock('$lib/api/log-pipeline', () => ({ logPipelineAPI: { preview: h.preview } }));

import PipelinePreview from './PipelinePreview.svelte';

const steps = [{ type: 'parser', parser: 'nginx' }] as never;

describe('PipelinePreview recent logs', () => {
  beforeEach(() => {
    Object.values(h).forEach((m) => m.mockReset());
    h.getProjects.mockResolvedValue({ projects: [{ id: 'p1', name: 'Checkout' }] });
    h.getLogs.mockResolvedValue({
      logs: [{ message: 'first message' }, { message: 'x'.repeat(120) }],
    });
  });

  it('Load recent log is disabled without a project', async () => {
    render(PipelinePreview, { props: { organizationId: 'org-1', steps } });
    expect(screen.getByRole('button', { name: 'Load recent log' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Checkout' })).toBeInTheDocument());
  });

  it('fetches limit 20 for the chosen project', async () => {
    render(PipelinePreview, { props: { organizationId: 'org-1', steps, projectId: 'p9' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Load recent log' }));
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledWith({ projectId: 'p9', limit: 20 }));
    expect(h.getProjects).not.toHaveBeenCalled();
  });

  it('org-wide pipelines pick a project inside the preview', async () => {
    render(PipelinePreview, { props: { organizationId: 'org-1', steps } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Checkout' })).toBeInTheDocument());
    await fireEvent.change(screen.getByLabelText('Project for recent logs'), { target: { value: 'p1' } });
    const btn = screen.getByRole('button', { name: 'Load recent log' });
    expect(btn).not.toBeDisabled();
    await fireEvent.click(btn);
    await waitFor(() => expect(h.getLogs).toHaveBeenCalledWith({ projectId: 'p1', limit: 20 }));
  });

  it('selecting a recent log fills the sample textarea', async () => {
    render(PipelinePreview, { props: { organizationId: 'org-1', steps, projectId: 'p1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Load recent log' }));
    const select = await screen.findByLabelText('Recent logs');
    // long messages are cut to 80 chars in the option label
    expect(screen.getByRole('option', { name: 'x'.repeat(80) + '...' })).toBeInTheDocument();
    await fireEvent.change(select, { target: { value: '0' } });
    expect((screen.getByLabelText('Sample log message') as HTMLTextAreaElement).value).toBe('first message');
  });

  it('empty result shows No recent logs', async () => {
    h.getLogs.mockResolvedValue({ logs: [] });
    render(PipelinePreview, { props: { organizationId: 'org-1', steps, projectId: 'p1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Load recent log' }));
    expect(await screen.findByText('No recent logs in this project')).toBeInTheDocument();
  });
});
