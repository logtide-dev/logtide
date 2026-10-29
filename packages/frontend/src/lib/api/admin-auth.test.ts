import { describe, it, expect, vi, afterEach } from 'vitest';
import { AdminAuthAPI, readAuthError } from './admin-auth';

function res(body: string, status = 400): Response {
  return new Response(body, { status });
}

afterEach(() => vi.unstubAllGlobals());

describe('readAuthError', () => {
  it('prefers error, then message, then fallback', async () => {
    expect(await readAuthError(res('{"error":"Bad slug"}'), 'x')).toBe('Bad slug');
    expect(await readAuthError(res('{"message":"Nope"}'), 'x')).toBe('Nope');
    expect(await readAuthError(res('{}'), 'x')).toBe('x');
    expect(await readAuthError(res(''), 'x')).toBe('x');
    expect(await readAuthError(res('<html>502</html>'), 'x')).toBe('x');
  });

  it('appends validation details', async () => {
    const body = JSON.stringify({ error: 'Validation error', details: [{ path: ['slug'], message: 'Invalid' }] });
    expect(await readAuthError(res(body), 'x')).toBe('Validation error (slug: Invalid)');
  });
});

describe('AdminAuthAPI.testConnection', () => {
  const api = new AdminAuthAPI(() => 't');

  it('passes a valid result through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res('{"success":true,"message":"ok"}', 200)));
    expect(await api.testConnection('1')).toEqual({ success: true, message: 'ok' });
  });

  it('reports an unexpected body as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res('not json', 200)));
    expect((await api.testConnection('1')).success).toBe(false);
  });

  it('throws the backend error text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res('{"error":"Admin access required"}', 403)));
    await expect(api.testConnection('1')).rejects.toThrow('Admin access required');
  });
});
