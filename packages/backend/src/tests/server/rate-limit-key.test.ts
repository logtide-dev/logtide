import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { rateLimitKeyGenerator } from '../../server.js';

const sha = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 32);

describe('rate limit key generator', () => {
  const secret = 'lp_' + 'k'.repeat(40);
  const bearer = 's'.repeat(64);

  it('never embeds the raw API key', () => {
    const key = rateLimitKeyGenerator({ headers: { 'x-api-key': secret }, ip: '1.2.3.4' });
    expect(key).not.toContain(secret);
    expect(key).toBe(`key:${sha(secret)}`);
  });

  it('never embeds the raw bearer token', () => {
    const key = rateLimitKeyGenerator({ headers: { authorization: `Bearer ${bearer}` }, ip: '1.2.3.4' });
    expect(key).not.toContain(bearer);
    expect(key).toBe(`key:${sha(bearer)}`);
  });

  it('is stable per credential and distinct across credentials', () => {
    const a = rateLimitKeyGenerator({ headers: { 'x-api-key': secret }, ip: '1.1.1.1' });
    const b = rateLimitKeyGenerator({ headers: { 'x-api-key': secret }, ip: '2.2.2.2' });
    const c = rateLimitKeyGenerator({ headers: { 'x-api-key': secret + 'x' }, ip: '1.1.1.1' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('falls back to the client ip without credentials', () => {
    expect(rateLimitKeyGenerator({ headers: {}, ip: '9.9.9.9' })).toBe('9.9.9.9');
  });
});
