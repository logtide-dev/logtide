import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authStore } from '$lib/stores/auth';
import { AdminAPI, readApiError } from './admin';
import { AdminAuthAPI } from './admin-auth';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('readApiError', () => {
  it('prefers the backend error field', async () => {
    expect(await readApiError(json(409, { error: 'Cannot disable yourself' }), 'fallback')).toBe(
      'Cannot disable yourself'
    );
  });

  it('falls back to message', async () => {
    expect(await readApiError(json(400, { message: 'Bad thing' }), 'fallback')).toBe('Bad thing');
  });

  it('tolerates non-JSON and empty bodies', async () => {
    expect(await readApiError(new Response('<html>502</html>', { status: 502 }), 'fallback')).toBe('fallback');
    expect(await readApiError(new Response(null, { status: 500 }), 'fallback')).toBe('fallback');
  });
});

describe('AdminAPI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: AdminAPI;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'A' } as any, 'tok');
    api = new AdminAPI();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces the backend error on GET failures', async () => {
    fetchMock.mockResolvedValue(json(404, { error: 'Organization not found' }));
    await expect(api.getOrganizationDetails('x')).rejects.toThrow('Organization not found');
  });

  it('surfaces the backend error on mutations instead of a fixed string', async () => {
    fetchMock.mockResolvedValue(json(409, { error: 'Cannot disable the last active admin' }));
    await expect(api.updateUserStatus('u2', true)).rejects.toThrow('Cannot disable the last active admin');

    fetchMock.mockResolvedValue(json(404, { error: 'User not found' }));
    await expect(api.resetUserPassword('u2', 'longpassword')).rejects.toThrow('User not found');

    fetchMock.mockResolvedValue(json(404, { error: 'Project not found' }));
    await expect(api.deleteProject('p')).rejects.toThrow('Project not found');

    fetchMock.mockResolvedValue(json(404, { error: 'Organization not found' }));
    await expect(api.deleteOrganization('o')).rejects.toThrow('Organization not found');
  });

  it('uses the fallback for non-JSON error bodies', async () => {
    fetchMock.mockResolvedValue(new Response('Bad gateway', { status: 502 }));
    await expect(api.updateUserRole('u2', true)).rejects.toThrow('Failed to update user role');
  });

  it('sends only the given entitlements and resets one by DELETE', async () => {
    fetchMock.mockResolvedValue(json(200, { removed: true }));
    await api.resetOrganizationEntitlement('org1', 'alerts.max_rules');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/organizations\/org1\/entitlements\/alerts\.max_rules$/);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  describe('list queries', () => {
    const urlOf = () => new URL(String(fetchMock.mock.calls[0][0]), 'http://x');

    beforeEach(() => {
      fetchMock.mockResolvedValue(json(200, { users: [], organizations: [], projects: [] }));
    });

    it('keeps the positional call signature', async () => {
      await api.getUsers(2, 25, 'bob');
      const q = urlOf().searchParams;
      expect(urlOf().pathname).toMatch(/\/admin\/users$/);
      expect([q.get('page'), q.get('limit'), q.get('search')]).toEqual(['2', '25', 'bob']);
    });

    it('sends sort, order and filters from an options object, skipping empty ones', async () => {
      await api.getProjects({ sort: 'organization', order: 'asc', deleted: 'only', organizationId: '', search: '' });
      const q = urlOf().searchParams;
      expect(q.get('page')).toBe('1');
      expect(q.get('limit')).toBe('50');
      expect(q.get('sort')).toBe('organization');
      expect(q.get('order')).toBe('asc');
      expect(q.get('deleted')).toBe('only');
      expect(q.has('organizationId')).toBe(false);
      expect(q.has('search')).toBe(false);
    });

    it('supports user filters and the organizations list', async () => {
      await api.getUsers({ role: 'admin', status: 'disabled', sort: 'last_login', order: 'desc' });
      expect(urlOf().searchParams.get('role')).toBe('admin');
      expect(urlOf().searchParams.get('status')).toBe('disabled');
      fetchMock.mockClear();
      await api.getOrganizations({ sort: 'members', order: 'desc', page: 3 });
      expect(urlOf().searchParams.get('sort')).toBe('members');
      expect(urlOf().searchParams.get('page')).toBe('3');
    });

    it('fetches the projects summary', async () => {
      await api.getProjectsSummary();
      expect(urlOf().pathname).toMatch(/\/admin\/projects\/summary$/);
    });
  });
});

describe('AdminAuthAPI', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tolerates non-JSON error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 500 })));
    const api = new AdminAuthAPI(() => 'tok');
    await expect(api.getProviders()).rejects.toThrow('Request failed');
  });

  it('surfaces the backend error field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(400, { error: 'Client Secret is required' })));
    const api = new AdminAuthAPI(() => 'tok');
    await expect(api.getProviders()).rejects.toThrow('Client Secret is required');
  });
});
