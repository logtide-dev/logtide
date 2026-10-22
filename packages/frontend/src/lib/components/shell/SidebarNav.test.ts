import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SidebarNav from './SidebarNav.svelte';
import { flatNavItems } from '$lib/nav/nav-items';

function renderNav(props: { pathname?: string; isAdmin?: boolean; onNavigate?: () => void } = {}) {
  return render(SidebarNav, {
    props: { pathname: '/dashboard', isAdmin: false, ...props },
  });
}

describe('SidebarNav', () => {
  it('renders every nav item once with its data-nav-item', () => {
    const { container } = renderNav();
    const rendered = Array.from(container.querySelectorAll('[data-nav-item]')).map((a) =>
      a.getAttribute('data-nav-item')
    );
    expect(rendered).toEqual(flatNavItems().map((i) => i.id));
  });

  it('hides the admin entry unless the user is an admin', () => {
    const { container, unmount } = renderNav({ isAdmin: false });
    expect(container.querySelector('[data-nav-item="admin"]')).toBeNull();
    unmount();

    const admin = renderNav({ isAdmin: true });
    expect(admin.container.querySelector('[data-nav-item="admin"]')).not.toBeNull();
    expect(screen.getByText('Instance admin')).toBeInTheDocument();
  });

  it('marks the active link with aria-current page', () => {
    const { container } = renderNav({ pathname: '/dashboard/security/rules/x' });
    const current = Array.from(container.querySelectorAll('[aria-current="page"]')).map((a) =>
      a.getAttribute('data-nav-item')
    );
    expect(current).toEqual(['security-rules']);
  });

  it('opens external links in a new tab with noopener', () => {
    const { container } = renderNav();
    for (const id of ['docs', 'github']) {
      const link = container.querySelector(`[data-nav-item="${id}"]`)!;
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('calls onNavigate when a link is clicked', async () => {
    const onNavigate = vi.fn();
    const { container } = renderNav({ onNavigate });
    await fireEvent.click(container.querySelector('[data-nav-item="logs"]')!);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('shows the instance admin entry with its own icon, not the security shield', () => {
    const { container } = renderNav({ isAdmin: true });
    const admin = container.querySelector('[data-nav-item="admin"]')!;
    const overview = container.querySelector('[data-nav-item="security-overview"]')!;
    expect(admin.querySelector('[data-icon]')!.getAttribute('data-icon')).toBe('admin');
    expect(overview.querySelector('[data-icon]')!.getAttribute('data-icon')).toBe('security-overview');
    // Different svg paths prove the icons differ
    expect(admin.querySelector('svg')!.innerHTML).not.toBe(overview.querySelector('svg')!.innerHTML);
  });

  it('uses sentence case section labels', () => {
    renderNav();
    for (const label of ['Explore', 'Monitor', 'Security', 'Manage', 'Help']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
