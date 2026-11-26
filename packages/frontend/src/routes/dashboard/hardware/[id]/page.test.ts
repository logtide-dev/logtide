import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({ goto: vi.fn(), get: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/api/hardware', () => ({ getHardwareHost: h.get }));

import IdPage from './+page.svelte';
import { page } from '$app/state';

describe('hardware host id redirect', () => {
  beforeEach(() => {
    h.goto.mockReset();
    h.get.mockReset();
    (page as { params: Record<string, string> }).params = { id: 'h1' };
    (page as { url: URL }).url = new URL('http://x/dashboard/hardware/h1?range=7d');
  });

  it('resolves the id and opens the Hardware tab of the host page', async () => {
    h.get.mockResolvedValue({ host: { id: 'h1', hostName: 'db 01', projectId: 'p1' }, series: [] });
    render(IdPage);
    await waitFor(() => expect(h.goto).toHaveBeenCalled());
    const [target, opts] = h.goto.mock.calls[0];
    const url = new URL(target, 'http://x');
    expect(url.pathname).toBe('/dashboard/metrics/hosts/db%2001');
    expect(url.searchParams.get('tab')).toBe('hardware');
    expect(url.searchParams.get('hw')).toBe('h1');
    // The scope is not narrowed to the host's project.
    expect(url.searchParams.get('project')).toBeNull();
    expect(url.searchParams.get('range')).toBe('7d');
    expect(opts).toEqual({ replaceState: true });
  });

  it('shows an error with a way back when the host cannot be resolved', async () => {
    h.get.mockRejectedValue(new Error('Host not found'));
    render(IdPage);
    expect(await screen.findByText('Host not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Hardware' }).getAttribute('href')).toBe('/dashboard/hardware');
    expect(h.goto).not.toHaveBeenCalled();
  });
});
