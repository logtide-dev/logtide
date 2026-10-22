import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { render, fireEvent, waitFor, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import ScopeBar from './ScopeBar.svelte';
import { scopeStore } from '$lib/stores/scope';
import { displayPreferences } from '$lib/stores/display-preferences';

const projects = [
  { id: 'p1', name: 'Project one' },
  { id: 'p2', name: 'Project two' },
];
const preset = (p: string) => ({ kind: 'preset', preset: p }) as never;

function setUrl(search = '') {
  (page as { url: URL }).url = new URL(`http://localhost/dashboard/logs${search}`);
}

function lastGotoUrl(): URL {
  const calls = vi.mocked(goto).mock.calls;
  return calls[calls.length - 1][0] as URL;
}

beforeEach(() => {
  scopeStore.reset();
  vi.mocked(goto).mockClear();
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
  setUrl();
});

describe('ScopeBar', () => {
  it('renders defaults', async () => {
    const { getByText, getByTestId } = render(ScopeBar, { props: { mode: 'multi', projects } });
    await tick();
    expect(getByText('All projects')).toBeTruthy();
    expect(getByText('Last 24 hours')).toBeTruthy();
    expect(getByTestId('scope-zone').textContent?.trim()).toBe('UTC');
  });

  it('reads the url into the store', async () => {
    setUrl('?project=p1&range=6h');
    const { getByText } = render(ScopeBar, { props: { mode: 'multi', projects } });
    await tick();
    expect(getByText('Project one')).toBeTruthy();
    expect(getByText('Last 6 hours')).toBeTruthy();
    expect(scopeStore.get()).toEqual({ projectIds: ['p1'], range: preset('6h') });
    expect(goto).not.toHaveBeenCalled();
  });

  it('leaves an already canonical url alone on mount', async () => {
    scopeStore.set({ projectIds: ['p1'], range: preset('1h') });
    setUrl('?project=p1&range=1h&q=timeout');
    render(ScopeBar, { props: { mode: 'multi', projects } });
    await tick();
    expect(scopeStore.get()).toEqual({ projectIds: ['p1'], range: preset('1h') });
    expect(goto).not.toHaveBeenCalled();
  });

  it('puts the remembered scope in the url on mount, keeping other params (UI-3)', async () => {
    scopeStore.set({ projectIds: ['p1'], range: preset('1h') });
    setUrl('?q=timeout&view=terminal&utm=x');
    render(ScopeBar, { props: { mode: 'multi', projects } });
    await tick();
    expect(goto).toHaveBeenCalledTimes(1);
    const url = lastGotoUrl();
    expect(url.searchParams.get('project')).toBe('p1');
    expect(url.searchParams.get('range')).toBe('1h');
    expect(url.searchParams.get('q')).toBe('timeout');
    expect(url.searchParams.get('utm')).toBe('x');
    expect(vi.mocked(goto).mock.calls[0][1]).toMatchObject({ replaceState: true });
  });

  it('writes all projects explicitly so a link does not depend on the viewer', async () => {
    render(ScopeBar, { props: { mode: 'multi', projects } });
    await tick();
    expect(lastGotoUrl().searchParams.get('project')).toBe('all');
  });

  it('canonicalUrl=false leaves the url to the page', async () => {
    render(ScopeBar, { props: { mode: 'multi', projects, canonicalUrl: false } });
    await tick();
    expect(goto).not.toHaveBeenCalled();
  });

  it('waits for the project list before writing the url', async () => {
    const { rerender } = render(ScopeBar, { props: { mode: 'single', projects: [] } });
    await tick();
    expect(goto).not.toHaveBeenCalled();
    await rerender({ mode: 'single', projects });
    await tick();
    expect(goto).toHaveBeenCalledTimes(1);
    expect(lastGotoUrl().searchParams.get('project')).toBe('p1');
  });

  it('preserves params it does not own on user actions', async () => {
    setUrl('?q=timeout&view=terminal&utm=x&project=p1');
    const { getByRole, findByText } = render(ScopeBar, { props: { mode: 'multi', projects } });
    await tick();
    await fireEvent.click(getByRole('button', { name: /Last 24 hours/ }));
    await fireEvent.click(await findByText('Last 7 days'));
    const url = lastGotoUrl();
    expect(url.searchParams.get('q')).toBe('timeout');
    expect(url.searchParams.get('view')).toBe('terminal');
    expect(url.searchParams.get('utm')).toBe('x');
    expect(url.searchParams.get('project')).toBe('p1');
    expect(url.searchParams.get('range')).toBe('7d');
    expect(vi.mocked(goto).mock.calls[0][1]).toMatchObject({ replaceState: true });
  });

  it('timeDisabled disables the time trigger', async () => {
    const { getByRole, queryByText } = render(ScopeBar, {
      props: { mode: 'multi', projects, timeDisabled: true },
    });
    await tick();
    const btn = getByRole('button', { name: /Last 24 hours/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(btn);
    expect(queryByText('Last 30 days')).toBeNull();
  });

  it('showTime=false hides the time trigger', async () => {
    const { queryByText, queryByTestId } = render(ScopeBar, {
      props: { mode: 'multi', projects, showTime: false },
    });
    await tick();
    expect(queryByText('Last 24 hours')).toBeNull();
    expect(queryByTestId('scope-zone')).toBeNull();
  });

  it('showProjects=false hides the project trigger', async () => {
    const { queryByText } = render(ScopeBar, {
      props: { mode: 'multi', projects, showProjects: false },
    });
    await tick();
    expect(queryByText('All projects')).toBeNull();
    expect(queryByText('Last 24 hours')).toBeTruthy();
  });

  it('empty projectIds means all projects', async () => {
    const { getByText } = render(ScopeBar, { props: { mode: 'multi', projects } });
    await tick();
    expect(getByText('All projects')).toBeTruthy();
    expect(scopeStore.get().projectIds).toEqual([]);
  });

  it('single mode picks the first project when none is valid', async () => {
    render(ScopeBar, { props: { mode: 'single', projects } });
    await tick();
    expect(scopeStore.get().projectIds).toEqual(['p1']);
    // the fallback is for this page only, the remembered scope is untouched (UI-1)
    expect(scopeStore.getPersisted().projectIds).toEqual([]);

    scopeStore.reset();
    scopeStore.setProjects(['zz']);
    render(ScopeBar, { props: { mode: 'single', projects } });
    await tick();
    expect(scopeStore.get().projectIds).toEqual(['p1']);
    expect(scopeStore.getPersisted().projectIds).toEqual(['zz']);
  });

  it('leaving a single-project page drops its fallback', async () => {
    const { unmount } = render(ScopeBar, { props: { mode: 'single', projects } });
    await tick();
    expect(scopeStore.get().projectIds).toEqual(['p1']);
    unmount();
    expect(scopeStore.get().projectIds).toEqual([]);
  });

  it('a preset the page does not offer is not persisted (UI-1)', async () => {
    scopeStore.setRange(preset('1h'));
    render(ScopeBar, {
      props: { mode: 'multi', projects, presets: ['24h', '7d', '30d'] as never },
    });
    await tick();
    expect(scopeStore.get().range).toEqual(preset('24h'));
    expect(scopeStore.getPersisted().range).toEqual(preset('1h'));
  });

  it('a user choice on a fallback page keeps the other remembered part', async () => {
    scopeStore.setRange(preset('1h'));
    const { getByRole, findByText } = render(ScopeBar, {
      props: { mode: 'multi', projects, presets: ['24h', '7d', '30d'] as never },
    });
    await tick();
    await fireEvent.click(getByRole('button', { name: /Last 24 hours/ }));
    await fireEvent.click(await findByText('Last 7 days'));
    expect(scopeStore.getPersisted().range).toEqual(preset('7d'));
  });

  it('multi mode drops foreign ids once projects load', async () => {
    scopeStore.setProjects(['zz', 'p1']);
    const { rerender } = render(ScopeBar, { props: { mode: 'multi', projects: [] } });
    await tick();
    expect(scopeStore.get().projectIds).toEqual(['zz', 'p1']);
    await rerender({ mode: 'multi', projects });
    await tick();
    expect(scopeStore.get().projectIds).toEqual(['p1']);
  });

  it('single mode keeps a stored multi selection when its first id is valid', async () => {
    scopeStore.setProjects(['p1', 'p2']);
    render(ScopeBar, { props: { mode: 'single', projects } });
    await tick();
    expect(scopeStore.get().projectIds).toEqual(['p1']);
    expect(scopeStore.getPersisted().projectIds).toEqual(['p1', 'p2']);
  });

  it('choosing a project updates store and url', async () => {
    scopeStore.setProjects(['p1']);
    const { getByRole, findByRole } = render(ScopeBar, { props: { mode: 'multi', projects } });
    await tick();
    await fireEvent.click(getByRole('button', { name: /Project one/ }));
    await fireEvent.click(await findByRole('checkbox', { name: /Project two/ }));
    expect(scopeStore.get().projectIds).toEqual([]);
    // selecting every project normalises to [] and is written as an explicit `all`
    expect(lastGotoUrl().searchParams.get('project')).toBe('all');
  });

  it('all projects clears a legacy projectId so it cannot bounce back (UI-4)', async () => {
    setUrl('?projectId=p1');
    const { getByRole } = render(ScopeBar, { props: { mode: 'multi', projects } });
    await tick();
    expect(scopeStore.get().projectIds).toEqual(['p1']);
    await fireEvent.click(getByRole('button', { name: /Project one/ }));
    await fireEvent.click(await screen.findByRole('checkbox', { name: /All projects/ }));
    const url = lastGotoUrl();
    expect(url.searchParams.get('project')).toBe('all');
    expect(url.searchParams.has('projectId')).toBe(false);
    // and the next reconcile of that url reads all projects, not p1
    (page as { url: URL }).url = url;
    await tick();
    expect(scopeStore.get().projectIds).toEqual([]);
  });

  it('choosing one project writes project to the url', async () => {
    const { getByRole, findByRole } = render(ScopeBar, { props: { mode: 'multi', projects } });
    await tick();
    await fireEvent.click(getByRole('button', { name: /All projects/ }));
    // from "all", unchecking Project one leaves Project two
    await fireEvent.click(await findByRole('checkbox', { name: /Project one/ }));
    expect(scopeStore.get().projectIds).toEqual(['p2']);
    expect(lastGotoUrl().searchParams.get('project')).toBe('p2');
  });

  it('choosing a preset updates store and url', async () => {
    const { getByRole, findByText } = render(ScopeBar, { props: { mode: 'multi', projects } });
    await tick();
    await fireEvent.click(getByRole('button', { name: /Last 24 hours/ }));
    await fireEvent.click(await findByText('Last 7 days'));
    await waitFor(() => expect(goto).toHaveBeenCalled());
    const url = lastGotoUrl();
    expect(url.searchParams.get('range')).toBe('7d');
    expect(url.searchParams.has('from')).toBe(false);
    expect(url.searchParams.has('to')).toBe(false);
    expect(scopeStore.get().range).toEqual(preset('7d'));
  });

  it('every button has an accessible name', async () => {
    const { container, getByRole, findByText } = render(ScopeBar, {
      props: { mode: 'multi', projects },
    });
    await tick();
    await fireEvent.click(getByRole('button', { name: /Last 24 hours/ }));
    await findByText('Last 30 days');
    const buttons = Array.from(document.body.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      const name = (b.textContent ?? '').trim() || b.getAttribute('aria-label') || '';
      expect(name, b.outerHTML.slice(0, 120)).not.toBe('');
    }
    expect(container).toBeTruthy();
  });
});
