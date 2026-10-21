import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { fireEvent } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './+page.svelte';
import { displayPreferences } from '$lib/stores/display-preferences';
import { themeStore } from '$lib/stores/theme';
import { currentProjectStore } from '$lib/stores/current-project';

describe('preferences page', () => {
  beforeEach(() => {
    localStorage.clear();
    currentProjectStore.set(null);
  });

  afterEach(() => {
    displayPreferences.set({ hour12: false, timeZone: null });
    vi.restoreAllMocks();
  });

  it('reflects stored 12-hour and America/Los_Angeles', () => {
    displayPreferences.set({ hour12: true, timeZone: 'America/Los_Angeles' });
    render(Page);
    expect(screen.getByText('12-hour (AM/PM)')).toBeInTheDocument();
    expect(screen.getByText('America/Los_Angeles')).toBeInTheDocument();
  });

  it('defaults show 24-hour and Browser default', () => {
    render(Page);
    expect(screen.getByText('24-hour')).toBeInTheDocument();
    expect(screen.getByText('Browser default')).toBeInTheDocument();
  });

  it('renders Browser default for a stored invalid zone without throwing', () => {
    displayPreferences.set({ hour12: false, timeZone: 'Not/AZone' });
    expect(() => render(Page)).not.toThrow();
    expect(screen.getByText('Browser default')).toBeInTheDocument();
    expect(screen.queryByText('Not/AZone')).toBeNull();
  });

  it('survives a missing Intl.supportedValuesOf', () => {
    const intl = Intl as unknown as { supportedValuesOf?: unknown };
    const original = intl.supportedValuesOf;
    intl.supportedValuesOf = undefined;
    try {
      displayPreferences.set({ hour12: false, timeZone: 'UTC' });
      render(Page);
      expect(screen.getByText('UTC')).toBeInTheDocument();
    } finally {
      intl.supportedValuesOf = original;
    }
  });

  it('shows a live sample line with the zone', () => {
    displayPreferences.set({ hour12: false, timeZone: 'UTC' });
    render(Page);
    expect(screen.getByTestId('time-sample').textContent).toMatch(/^\s*Now: .*UTC/);
  });

  it('theme buttons call themeStore.setPreference', async () => {
    const spy = vi.spyOn(themeStore, 'setPreference');
    render(Page);
    await fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    await fireEvent.click(screen.getByRole('button', { name: 'System' }));
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['light', 'dark', 'system']);
  });

  it('Connect an app falls back to /dashboard/projects without a project', () => {
    render(Page);
    const link = screen.getByRole('link', { name: 'Connect an app' });
    expect(link.getAttribute('href')).toBe('/dashboard/projects');
    expect(screen.queryByText(/restart tutorial/i)).toBeNull();
  });

  it('Connect an app links to the current project settings#connect', () => {
    currentProjectStore.set('proj-1');
    render(Page);
    const link = screen.getByRole('link', { name: 'Connect an app' });
    expect(link.getAttribute('href')).toBe('/dashboard/projects/proj-1/settings#connect');
  });

  it('uses the app-wide copy', () => {
    const { container } = render(Page);
    expect(container.textContent).toContain('Applies to every page in this browser.');
    expect(container.textContent).not.toContain('dashboard panels');
  });
});
