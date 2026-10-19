import { describe, it, expect, vi, beforeAll } from 'vitest';
import { get } from 'svelte/store';
import { termsRecheck } from '$lib/stores/terms-recheck';

const responses: Response[] = [];
const originalFetch = vi.fn(async () => responses.shift() as Response);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

// The interceptor patches window.fetch once per module, so install it once for
// the whole file.
beforeAll(async () => {
  window.fetch = originalFetch as unknown as typeof window.fetch;
  const { installAuthFetchInterceptor } = await import('./fetch-interceptor');
  installAuthFetchInterceptor();
});

describe('fetch interceptor terms re-check', () => {
  it('asks for a terms re-check on a 403 terms_not_accepted and leaves the body readable', async () => {
    const before = get(termsRecheck);
    responses.push(json(403, { error: 'terms_not_accepted' }));
    const res = await window.fetch('http://localhost/api/v1/projects', { method: 'POST' });
    expect(await res.json()).toEqual({ error: 'terms_not_accepted' });
    await settle();
    expect(get(termsRecheck)).toBe(before + 1);
  });

  it('ignores other 403s and successful responses', async () => {
    const before = get(termsRecheck);
    responses.push(json(403, { error: 'email_not_verified' }));
    await window.fetch('http://localhost/api/v1/projects', { method: 'POST' });
    responses.push(json(200, { ok: true }));
    await window.fetch('http://localhost/api/v1/projects');
    responses.push(new Response('not json', { status: 403 }));
    await window.fetch('http://localhost/api/v1/projects', { method: 'POST' });
    await settle();
    expect(get(termsRecheck)).toBe(before);
  });
});

describe('fetch interceptor session logout', () => {
  // The billing routes proxy an external service: a 401 there must never look
  // like an expired LogTide session (the core already maps service-auth
  // failures to 502; this is the client-side guard).
  it('never logs out on a 401 from a billing route', async () => {
    const { authStore } = await import('$lib/stores/auth');
    const clearAuth = vi.spyOn(authStore, 'clearAuth');
    localStorage.setItem('logtide_auth', JSON.stringify({ token: 'session-1' }));
    for (const path of ['billing', 'billing/invoices', 'billing/checkout/cs_test_1', 'billing?x=1']) {
      responses.push(json(401, { error: 'unauthorized' }));
      await window.fetch(`http://localhost/api/v1/organizations/org-1/${path}`);
    }
    expect(clearAuth).not.toHaveBeenCalled();

    // Control: the same 401 on any other API route still ends the session.
    responses.push(json(401, { error: 'unauthorized' }));
    await window.fetch('http://localhost/api/v1/organizations/org-1/members');
    expect(clearAuth).toHaveBeenCalledTimes(1);
    clearAuth.mockRestore();
  });
});
