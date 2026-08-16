import { describe, it, expect } from 'vitest';
import { DIGEST_SECTION_KEYS, DIGEST_SECTION_DEFAULTS, mergeDigestSections } from './digest.js';

describe('digest sections', () => {
  it('has 15 keys, first five enabled by default', () => {
    expect(DIGEST_SECTION_KEYS).toHaveLength(15);
    expect(DIGEST_SECTION_DEFAULTS.logVolume).toBe(true);
    expect(DIGEST_SECTION_DEFAULTS.uptime).toBe(true);
    expect(DIGEST_SECTION_DEFAULTS.traces).toBe(false);
    expect(DIGEST_SECTION_DEFAULTS.teamActivity).toBe(false);
  });

  it('merges partials over defaults', () => {
    const merged = mergeDigestSections({ traces: true, logVolume: false });
    expect(merged.traces).toBe(true);
    expect(merged.logVolume).toBe(false);
    expect(merged.security).toBe(true);
  });

  it('null/undefined yields pure defaults and ignores junk keys', () => {
    expect(mergeDigestSections(null)).toEqual(DIGEST_SECTION_DEFAULTS);
    expect(mergeDigestSections(undefined)).toEqual(DIGEST_SECTION_DEFAULTS);
    expect(mergeDigestSections({ nope: true } as never)).toEqual(DIGEST_SECTION_DEFAULTS);
    expect(mergeDigestSections({ traces: 'yes' } as never).traces).toBe(false);
  });

  it('does not mutate the defaults', () => {
    mergeDigestSections({ logVolume: false });
    expect(DIGEST_SECTION_DEFAULTS.logVolume).toBe(true);
  });
});
