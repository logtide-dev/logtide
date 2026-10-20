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

describe('fetch interceptor terms re-check', () => {
  beforeAll(async () => {
    window.fetch = originalFetch as unknown as typeof window.fetch;
    const { installAuthFetchInterceptor } = await import('./fetch-interceptor');
    installAuthFetchInterceptor();
  });

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
