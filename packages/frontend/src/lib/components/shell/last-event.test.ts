import { describe, it, expect } from 'vitest';
import { describeLastEvent } from './last-event';

const now = new Date('2026-10-22T12:00:00.000Z');
const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();

describe('describeLastEvent', () => {
  it('is waiting when there is no date and nothing is received', () => {
    expect(describeLastEvent({ lastEventAt: null, receiving: false, now })).toEqual({
      kind: 'waiting',
      text: 'Waiting for data',
    });
    expect(describeLastEvent({ lastEventAt: undefined, receiving: false, now }).kind).toBe('waiting');
  });

  it('says Receiving data when there is no date but data is available', () => {
    expect(describeLastEvent({ lastEventAt: null, receiving: true, now })).toEqual({
      kind: 'receiving',
      text: 'Receiving data',
    });
  });

  it('describes a recent date relatively', () => {
    expect(describeLastEvent({ lastEventAt: iso(-5 * 60_000), receiving: true, now })).toEqual({
      kind: 'ago',
      text: 'Last event 5 minutes ago',
    });
  });

  it('clamps a date in the future to just now', () => {
    const result = describeLastEvent({ lastEventAt: iso(3 * 60_000), receiving: true, now });
    expect(result).toEqual({ kind: 'ago', text: 'Last event just now' });
    expect(result.text).not.toMatch(/\bin \d/);
  });

  it('treats an unparseable date as missing', () => {
    expect(describeLastEvent({ lastEventAt: 'not a date', receiving: false, now }).kind).toBe('waiting');
    expect(describeLastEvent({ lastEventAt: 'not a date', receiving: true, now }).kind).toBe('receiving');
  });

  it('handles a very old date with a non-empty text', () => {
    const result = describeLastEvent({ lastEventAt: iso(-400 * 86_400_000), receiving: false, now });
    expect(result.kind).toBe('ago');
    expect(result.text.length).toBeGreaterThan('Last event '.length);
    expect(result.text).not.toContain('Invalid');
  });
});
