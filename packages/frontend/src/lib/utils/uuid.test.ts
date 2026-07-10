import { describe, it, expect, afterEach } from 'vitest';
import { uuid } from './uuid';

const V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid', () => {
  const originalRandomUUID = crypto.randomUUID;

  afterEach(() => {
    crypto.randomUUID = originalRandomUUID;
  });

  it('produces a valid v4 UUID', () => {
    expect(uuid()).toMatch(V4_RE);
  });

  it('produces unique values', () => {
    const set = new Set(Array.from({ length: 1000 }, () => uuid()));
    expect(set.size).toBe(1000);
  });

  it('falls back to getRandomValues when randomUUID is unavailable (non-secure context)', () => {
    // Simulate plain HTTP on a LAN IP where crypto.randomUUID does not exist.
    (crypto as { randomUUID?: unknown }).randomUUID = undefined;
    expect(uuid()).toMatch(V4_RE);
  });
});
