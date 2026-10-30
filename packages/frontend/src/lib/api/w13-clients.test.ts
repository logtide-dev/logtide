import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthAPI } from './auth';
import { FirstSignalAPI, ProjectLastEventsAPI } from './first-signal';
import { OnboardingAPI } from './onboarding';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('w13 api clients', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requestPasswordReset posts to /auth/password-reset/request with the email', async () => {
    fetchMock.mockResolvedValue(json(202, { message: 'ok' }));
    await expect(new AuthAPI().requestPasswordReset('a@b.co')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/auth\/password-reset\/request$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.co' });
  });

  it('requestPasswordReset rejects on 429', async () => {
    fetchMock.mockResolvedValue(json(429, {}));
    await expect(new AuthAPI().requestPasswordReset('a@b.co')).rejects.toThrow('rate_limited');
  });

  it('confirmPasswordReset maps invalid_or_expired_token', async () => {
    fetchMock.mockResolvedValue(json(400, { error: 'invalid_or_expired_token' }));
    await expect(new AuthAPI().confirmPasswordReset('t', 'password1')).rejects.toThrow(
      'invalid_or_expired_token'
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/auth\/password-reset\/confirm$/);
    expect(JSON.parse(init.body)).toEqual({ token: 't', password: 'password1' });
  });

  it('confirmPasswordReset resolves on 200', async () => {
    fetchMock.mockResolvedValue(json(200, { reset: true }));
    await expect(new AuthAPI().confirmPasswordReset('t', 'password1')).resolves.toBeUndefined();
  });

  it('firstSignalAPI.get calls /projects/:id/first-signal with the bearer token', async () => {
    const signal = {
      logs: true,
      traces: false,
      metrics: false,
      errors: false,
      firstAt: null,
      lastEventAt: null,
    };
    fetchMock.mockResolvedValue(json(200, signal));
    await expect(new FirstSignalAPI(() => 'tok').get('p1')).resolves.toEqual(signal);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/projects\/p1\/first-signal$/);
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('projectLastEventsAPI unwraps lastEvents', async () => {
    fetchMock.mockResolvedValue(json(200, { lastEvents: { p1: null } }));
    await expect(new ProjectLastEventsAPI(() => 'tok').get('o1')).resolves.toEqual({ p1: null });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /\/projects\/last-events\?organizationId=o1$/
    );
  });

  it('getState parses step, organizationId, projectId', async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        checklistItems: {},
        checklistCollapsed: false,
        checklistDismissed: false,
        tutorialCompleted: false,
        tutorialStep: 2,
        tutorialSkipped: false,
        step: 'connect',
        organizationId: 'o1',
        projectId: 'p1',
      })
    );
    const state = await new OnboardingAPI(() => 'tok').getState();
    expect(state.step).toBe('connect');
    expect(state.organizationId).toBe('o1');
    expect(state.projectId).toBe('p1');
  });
});
