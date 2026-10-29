import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ProjectSideNav from './ProjectSideNav.svelte';

describe('ProjectSideNav', () => {
  it('renders the 7 items with deep links', () => {
    render(ProjectSideNav, { projectId: 'p1', pathname: '/dashboard/projects/p1' });
    const nav = screen.getByRole('navigation', { name: 'Project sections' });
    const links = Array.from(nav.querySelectorAll('a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Health',
      'General',
      'Connect',
      'API keys',
      'Receivers',
      'Notifications',
      'Danger zone',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/dashboard/projects/p1',
      '/dashboard/projects/p1/settings#general',
      '/dashboard/projects/p1/settings#connect',
      '/dashboard/projects/p1/settings#api-keys',
      '/dashboard/projects/p1/settings#inbound-webhooks',
      '/dashboard/projects/p1/settings#notifications',
      '/dashboard/projects/p1/settings#danger-zone',
    ]);
  });

  it('shows the issue count badge on Health only when above zero', async () => {
    const { rerender } = render(ProjectSideNav, { projectId: 'p1', pathname: '/dashboard/projects/p1', issueCount: 2 });
    expect(screen.getByTestId('project-nav-badge')).toHaveTextContent('2');
    await rerender({ projectId: 'p1', pathname: '/dashboard/projects/p1', issueCount: 0 });
    expect(screen.queryByTestId('project-nav-badge')).toBeNull();
  });

  it('marks Health active on the project page and the hash section on settings', () => {
    const { unmount } = render(ProjectSideNav, { projectId: 'p1', pathname: '/dashboard/projects/p1' });
    expect(screen.getByTestId('project-nav-health')).toHaveAttribute('aria-current', 'page');
    unmount();
    render(ProjectSideNav, { projectId: 'p1', pathname: '/dashboard/projects/p1/settings', hash: '#connect' });
    expect(screen.getByTestId('project-nav-connect')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('project-nav-health')).not.toHaveAttribute('aria-current');
  });

  it('shows only Health for a deleted project', () => {
    render(ProjectSideNav, { projectId: 'p1', pathname: '/dashboard/projects/p1', deleted: true });
    expect(screen.getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['Health']);
  });
});
