import { describe, it, expect } from 'vitest';
import { referenceLabel } from './reference-label';

describe('referenceLabel', () => {
  it('is MITRE reference only for attack.mitre.org and subdomains', () => {
    expect(referenceLabel('https://attack.mitre.org/techniques/T1059/')).toBe('MITRE reference');
    expect(referenceLabel('https://eu.attack.mitre.org/x')).toBe('MITRE reference');
  });

  it('uses the hostname for look-alike hosts and paths', () => {
    expect(referenceLabel('https://example.com/attack.mitre.org')).toBe('example.com');
    expect(referenceLabel('https://attack.mitre.org.evil.example/x')).toBe('attack.mitre.org.evil.example');
    expect(referenceLabel('https://notattack.mitre.org/x')).toBe('notattack.mitre.org');
  });

  it('removes www.', () => {
    expect(referenceLabel('https://www.example.com/a')).toBe('example.com');
  });

  it('is Reference for garbage', () => {
    expect(referenceLabel('not a url')).toBe('Reference');
    expect(referenceLabel('')).toBe('Reference');
  });
});
