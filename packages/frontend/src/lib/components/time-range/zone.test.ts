import { describe, it, expect } from 'vitest';
import { getLocalTimeZone } from '@internationalized/date';
import { resolveZone, toInputValue, fromInputValue } from './zone.js';

describe('toInputValue', () => {
  it('renders wall clock in the zone', () => {
    const d = new Date('2026-10-21T10:00:00Z');
    expect(toInputValue(d, 'Europe/Rome')).toBe('2026-10-21T12:00');
    expect(toInputValue(d, 'UTC')).toBe('2026-10-21T10:00');
  });

  it('renders midnight as 00:00, never 24:00', () => {
    expect(toInputValue(new Date('2026-10-21T00:00:00Z'), 'UTC')).toBe('2026-10-21T00:00');
  });
});

describe('fromInputValue', () => {
  it('parses wall clock in the zone', () => {
    expect(fromInputValue('2026-10-21T12:00', 'Europe/Rome')!.toISOString()).toBe(
      '2026-10-21T10:00:00.000Z'
    );
  });

  it('follows the DST change', () => {
    const d = fromInputValue('2026-10-26T12:00', 'Europe/Rome')!;
    expect(d.toISOString()).toBe('2026-10-26T11:00:00.000Z');
    expect(toInputValue(d, 'Europe/Rome')).toBe('2026-10-26T12:00');
  });

  it('returns null for incomplete or invalid text', () => {
    expect(fromInputValue('', 'UTC')).toBeNull();
    expect(fromInputValue('2026-10-21', 'UTC')).toBeNull();
    expect(fromInputValue('2026-13-45T99:00', 'UTC')).toBeNull();
  });
});

describe('resolveZone', () => {
  it('falls back to the browser zone', () => {
    const local = getLocalTimeZone();
    expect(resolveZone(null)).toBe(local);
    expect(resolveZone(undefined)).toBe(local);
    expect(resolveZone('')).toBe(local);
    expect(resolveZone('browser')).toBe(local);
    expect(resolveZone('Not/AZone')).toBe(local);
  });

  it('keeps a valid IANA id', () => {
    expect(resolveZone('Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(resolveZone('UTC')).toBe('UTC');
  });
});
