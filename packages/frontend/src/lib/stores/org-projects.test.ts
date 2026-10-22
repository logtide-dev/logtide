import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

const getProjects = vi.fn();
const getProjectDataAvailability = vi.fn();
vi.mock('$lib/api/projects', () => ({
  projectsAPI: {
    getProjects: (...a: unknown[]) => getProjects(...a),
    getProjectDataAvailability: (...a: unknown[]) => getProjectDataAvailability(...a),
  },
}));
vi.mock('$lib/utils/auth', () => ({ getAuthToken: () => 'tok' }));
vi.mock('$lib/config', () => ({ getApiBaseUrl: () => 'http://api.test/api/v1' }));

import { projectLastEventsAPI } from '$lib/api/first-signal';
import { orgProjectsStore } from './org-projects';

const p = (id: string, name: string) => ({ id, name });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('orgProjectsStore', () => {
  const lastEvents = vi.spyOn(projectLastEventsAPI, 'get');

  beforeEach(() => {
    orgProjectsStore.reset();
    getProjects.mockReset();
    getProjectDataAvailability.mockReset();
    lastEvents.mockReset();
  });

  afterEach(() => {
    orgProjectsStore.reset();
  });

  it('fills projects, last events and the receiving set', async () => {
    getProjects.mockResolvedValue({ projects: [p('a', 'Alpha'), p('b', 'Beta')] });
    getProjectDataAvailability.mockResolvedValue({ logs: ['a'], traces: ['b'], metrics: ['a'] });
    lastEvents.mockResolvedValue({ a: '2026-10-21T10:00:00.000Z', b: null });

    await orgProjectsStore.load('org-1');

    const s = get(orgProjectsStore);
    expect(s.orgId).toBe('org-1');
    expect(s.projects.map((x) => x.id)).toEqual(['a', 'b']);
    expect(s.lastEventAt).toEqual({ a: '2026-10-21T10:00:00.000Z', b: null });
    expect([...s.receiving].sort()).toEqual(['a', 'b']);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
    expect(orgProjectsStore.projectName('b')).toBe('Beta');
    expect(orgProjectsStore.projectName('zzz')).toBeNull();
  });

  it('tolerates a failing last-events call', async () => {
    getProjects.mockResolvedValue({ projects: [p('a', 'Alpha')] });
    getProjectDataAvailability.mockResolvedValue({ logs: ['a'], traces: [], metrics: [] });
    lastEvents.mockRejectedValue(new Error('404'));

    await orgProjectsStore.load('org-1');

    const s = get(orgProjectsStore);
    expect(s.projects).toHaveLength(1);
    expect(s.lastEventAt).toEqual({});
    expect(s.receiving.has('a')).toBe(true);
    expect(s.error).toBeNull();
  });

  it('ignores a stale response after the organization changed', async () => {
    const slow = deferred<{ projects: ReturnType<typeof p>[] }>();
    getProjects.mockImplementation((org: string) =>
      org === 'org-a' ? slow.promise : Promise.resolve({ projects: [p('b1', 'B project')] })
    );
    getProjectDataAvailability.mockResolvedValue({ logs: [], traces: [], metrics: [] });
    lastEvents.mockResolvedValue({});

    const loadA = orgProjectsStore.load('org-a');
    await orgProjectsStore.load('org-b');
    slow.resolve({ projects: [p('a1', 'A project')] });
    await loadA;

    const s = get(orgProjectsStore);
    expect(s.orgId).toBe('org-b');
    expect(s.projects.map((x) => x.id)).toEqual(['b1']);
  });

  it('sets error and keeps previous projects on failure', async () => {
    getProjects.mockResolvedValueOnce({ projects: [p('a', 'Alpha')] });
    getProjectDataAvailability.mockResolvedValue({ logs: [], traces: [], metrics: [] });
    lastEvents.mockResolvedValue({});
    await orgProjectsStore.load('org-1');

    getProjects.mockRejectedValueOnce(new Error('boom'));
    await orgProjectsStore.load('org-1');

    const s = get(orgProjectsStore);
    expect(s.error).toBe('boom');
    expect(s.projects.map((x) => x.id)).toEqual(['a']);
    expect(s.loading).toBe(false);
  });

  it('drops the previous organization projects while a new organization loads', async () => {
    getProjects.mockResolvedValueOnce({ projects: [p('a', 'Alpha')] });
    getProjectDataAvailability.mockResolvedValue({ logs: [], traces: [], metrics: [] });
    lastEvents.mockResolvedValue({});
    await orgProjectsStore.load('org-1');

    const slow = deferred<{ projects: ReturnType<typeof p>[] }>();
    getProjects.mockReturnValueOnce(slow.promise);
    const pending = orgProjectsStore.load('org-2');
    expect(get(orgProjectsStore).projects).toEqual([]);
    expect(get(orgProjectsStore).loading).toBe(true);
    slow.resolve({ projects: [] });
    await pending;
  });

  it('reads last events through the real W13 client (unwrapped record)', async () => {
    lastEvents.mockRestore();
    getProjects.mockResolvedValue({ projects: [p('a', 'Alpha')] });
    getProjectDataAvailability.mockResolvedValue({ logs: [], traces: [], metrics: [] });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ lastEvents: { a: '2026-10-21T10:00:00.000Z' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await orgProjectsStore.load('org-9');
      expect(get(orgProjectsStore).lastEventAt).toEqual({ a: '2026-10-21T10:00:00.000Z' });
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(
        '/projects/last-events?organizationId=org-9'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
