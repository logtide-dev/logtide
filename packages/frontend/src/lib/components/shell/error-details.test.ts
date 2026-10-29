import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authStore } from '$lib/stores/auth';
import { buildErrorDetails } from './error-details';

const ctx = { pathname: '/dashboard/logs', version: 'v9.9.9', now: new Date('2026-10-22T10:00:00.000Z') };

beforeEach(() => {
  authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'Ann' }, 'secret-token-abc123');
});

afterEach(() => authStore.clearAuth());

describe('buildErrorDetails', () => {
  it('omits the query string and hash', () => {
    const text = buildErrorDetails(new Error('x'), { ...ctx, pathname: '/dashboard/logs?q=level:error&project=p1#top' });
    expect(text).toContain('Path: /dashboard/logs\n');
    expect(text).not.toContain('q=level');
    expect(text).not.toContain('project=p1');
    expect(text).not.toContain('#top');
  });

  it('strips query strings from URLs inside the message and stack', () => {
    const err = new Error('failed https://app.example.com/api/v1/logs?token=zzz&q=1');
    err.stack = 'Error: x\n    at fetch (https://app.example.com/assets/app.js?v=3:10:5)';
    const text = buildErrorDetails(err, ctx);
    expect(text).not.toContain('token=zzz');
    expect(text).not.toContain('?v=3');
    expect(text).toContain('https://app.example.com/api/v1/logs');
  });

  it('never contains the auth token', () => {
    const err = new Error('request failed with Bearer secret-token-abc123 and token secret-token-abc123');
    const text = buildErrorDetails(err, ctx);
    expect(text).not.toContain('secret-token-abc123');
    expect(text).toContain('Bearer [redacted]');
  });

  it('redacts bearer values even when the token is not in the store', () => {
    authStore.clearAuth();
    const text = buildErrorDetails(new Error('Authorization: Bearer abc.def.ghi'), ctx);
    expect(text).not.toContain('abc.def.ghi');
    expect(text).toContain('Bearer [redacted]');
  });

  it('handles non-Error values', () => {
    expect(buildErrorDetails('plain string', ctx)).toContain('Message: plain string');
    expect(buildErrorDetails(undefined, ctx)).toContain('Message: Unknown error');
    expect(buildErrorDetails({ code: 7 }, ctx)).toContain('Message: {"code":7}');
  });

  it('includes version and ISO timestamp', () => {
    const text = buildErrorDetails(new Error('x'), ctx);
    expect(text).toContain('Version: v9.9.9');
    expect(text).toContain('Time: 2026-10-22T10:00:00.000Z');
    expect(text).toContain('User agent: ');
  });
});
