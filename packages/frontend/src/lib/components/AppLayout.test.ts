import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/api/notifications', () => ({
  NotificationsAPI: class {
    async getNotifications() {
      return { notifications: [], unreadCount: 0 };
    }
  },
}));
vi.mock('$lib/api/auth', () => ({ authAPI: { logout: vi.fn() } }));
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    async getProjects() {
      return { projects: [] };
    }
  },
  projectsAPI: {
    getProjects: vi.fn(async () => ({ projects: [] })),
    getProjectDataAvailability: vi.fn(async () => ({ logs: [], traces: [], metrics: [] })),
  },
}));

import AppLayout from './AppLayout.svelte';
import { authStore } from '$lib/stores/auth';
import { page } from '$app/state';

const SECTION_LABELS = ['Dashboards', 'Logs', 'Traces', 'Metrics', 'Errors', 'Sessions', 'Web vitals', 'Incidents', 'Alerts', 'Uptime', 'Overview', 'Rules', 'Projects', 'Settings', 'Docs', 'GitHub'];

function navLabels(root: Element): string[] {
  return Array.from(root.querySelectorAll('[data-nav-item]')).map((a) => a.textContent!.trim());
}

describe('AppLayout shell', () => {
  beforeEach(() => {
    (page as { url: URL }).url = new URL('http://localhost/dashboard/logs');
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'Ann', is_admin: false }, 'tok');
  });

  afterEach(() => {
    authStore.clearAuth();
  });

  it('renders the same nav labels in the desktop sidebar and the drawer', () => {
    const { container } = render(AppLayout);
    const drawer = container.querySelector('aside[data-drawer]')!;
    const desktop = container.querySelector('aside:not([data-drawer])')!;
    expect(navLabels(desktop)).toEqual(SECTION_LABELS);
    expect(navLabels(drawer)).toEqual(navLabels(desktop));
  });

  it('drawer is hidden but present when closed', () => {
    const { container } = render(AppLayout);
    const drawer = container.querySelector('aside[data-drawer]')!;
    expect(drawer.className).toContain('-translate-x-full');
    expect(drawer.className).toContain('transition-');
    expect(drawer.classList.contains('hidden')).toBe(false);
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    expect((drawer as HTMLElement & { inert: boolean }).inert).toBe(true);
  });

  it('opening the menu removes the hidden state', async () => {
    const { container } = render(AppLayout);
    await fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = container.querySelector('aside[data-drawer]')!;
    await waitFor(() => expect(drawer.className).toContain('translate-x-0'));
    expect(drawer.className).not.toContain('-translate-x-full');
    expect(drawer).not.toHaveAttribute('aria-hidden');
    expect((drawer as HTMLElement & { inert: boolean }).inert).toBe(false);
  });

  it('closes the drawer on navigation and on Escape', async () => {
    const { container } = render(AppLayout);
    const drawer = () => container.querySelector('aside[data-drawer]')!;

    await fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await waitFor(() => expect(drawer().className).toContain('translate-x-0'));
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(drawer().className).toContain('-translate-x-full'));

    await fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await waitFor(() => expect(drawer().className).toContain('translate-x-0'));
    const link = drawer().querySelector('[data-nav-item="traces"]')!;
    await fireEvent.click(link);
    await waitFor(() => expect(drawer().className).toContain('-translate-x-full'));
  });

  it('shows the instance admin entry only for admins', () => {
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'Ann', is_admin: true }, 'tok');
    const { container } = render(AppLayout);
    const desktop = container.querySelector('aside:not([data-drawer])')!;
    expect(desktop.querySelector('[data-nav-item="admin"]')).not.toBeNull();
  });
});
