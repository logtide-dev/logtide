import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

const { getSummary } = vi.hoisted(() => ({ getSummary: vi.fn() }));
vi.mock('$lib/api/project-health', () => ({ projectHealthAPI: { getSummary } }));

import { projectHealthStore, PROJECT_HEALTH_POLL_MS } from './project-health';

const entry = {
  status: 'warning',
  openIssues: [{ checkKey: 'revoked_key', severity: 'warning', muted: false }],
};

describe('projectHealthStore', () => {
  beforeEach(() => {
    getSummary.mockReset();
    projectHealthStore.reset();
  });
  afterEach(() => {
    projectHealthStore.reset();
    vi.useRealTimers();
  });

  it('loads the summary for an org', async () => {
    getSummary.mockResolvedValue({ projects: { p1: entry } });
    await projectHealthStore.load('org-1');
    const s = get(projectHealthStore);
    expect(s.orgId).toBe('org-1');
    expect(s.byProject.p1.status).toBe('warning');
    expect(s.loading).toBe(false);
  });

  it('ignores a stale response after the org changed', async () => {
    let resolveA!: (v: unknown) => void;
    getSummary.mockImplementationOnce(() => new Promise((r) => (resolveA = r)));
    getSummary.mockResolvedValueOnce({ projects: { b: entry } });
    const a = projectHealthStore.load('org-a');
    await projectHealthStore.load('org-b');
    resolveA({ projects: { a: entry } });
    await a;
    const s = get(projectHealthStore);
    expect(s.orgId).toBe('org-b');
    expect(Object.keys(s.byProject)).toEqual(['b']);
  });

  it('clears the previous org data while the next org loads', async () => {
    getSummary.mockResolvedValueOnce({ projects: { a: entry } });
    await projectHealthStore.load('org-a');
    let resolveB!: (v: unknown) => void;
    getSummary.mockImplementationOnce(() => new Promise((r) => (resolveB = r)));
    const b = projectHealthStore.load('org-b');
    expect(get(projectHealthStore).byProject).toEqual({});
    resolveB({ projects: {} });
    await b;
  });

  it('keeps previous data when a refresh fails', async () => {
    getSummary.mockResolvedValueOnce({ projects: { a: entry } });
    await projectHealthStore.load('org-a');
    getSummary.mockRejectedValueOnce(new Error('boom'));
    await projectHealthStore.load('org-a');
    const s = get(projectHealthStore);
    expect(s.byProject.a).toBeDefined();
    expect(s.loading).toBe(false);
  });

  it('polls every 5 minutes while subscribed and stops after', async () => {
    vi.useFakeTimers();
    getSummary.mockResolvedValue({ projects: {} });
    const unsub = projectHealthStore.subscribe(() => {});
    await projectHealthStore.load('org-1');
    expect(getSummary).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PROJECT_HEALTH_POLL_MS);
    expect(getSummary).toHaveBeenCalledTimes(2);
    unsub();
    await vi.advanceTimersByTimeAsync(PROJECT_HEALTH_POLL_MS);
    expect(getSummary).toHaveBeenCalledTimes(2);
  });
});
