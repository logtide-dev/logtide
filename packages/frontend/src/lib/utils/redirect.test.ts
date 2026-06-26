import { describe, it, expect } from 'vitest';
import { isSafeInternalPath, safeRedirect } from './redirect';

describe('isSafeInternalPath', () => {
  it('accepts a normal in-app path', () => {
    expect(isSafeInternalPath('/dashboard')).toBe(true);
    expect(isSafeInternalPath('/dashboard/projects/1?tab=x')).toBe(true);
    expect(isSafeInternalPath('/')).toBe(true);
  });

  it('rejects empty / nullish values', () => {
    expect(isSafeInternalPath(null)).toBe(false);
    expect(isSafeInternalPath(undefined)).toBe(false);
    expect(isSafeInternalPath('')).toBe(false);
  });

  it('rejects absolute URLs to other origins', () => {
    expect(isSafeInternalPath('https://evil.com')).toBe(false);
    expect(isSafeInternalPath('http://evil.com/path')).toBe(false);
  });

  it('rejects protocol-relative URLs (//evil.com)', () => {
    expect(isSafeInternalPath('//evil.com')).toBe(false);
    expect(isSafeInternalPath('//evil.com/path')).toBe(false);
  });

  it('rejects backslash-smuggled protocol-relative URLs (/\\evil.com)', () => {
    expect(isSafeInternalPath('/\\evil.com')).toBe(false);
  });

  it('rejects values not anchored at the site root', () => {
    expect(isSafeInternalPath('dashboard')).toBe(false);
    expect(isSafeInternalPath(' /dashboard')).toBe(false);
    expect(isSafeInternalPath('javascript:alert(1)')).toBe(false);
  });
});

describe('safeRedirect', () => {
  it('returns the path when safe', () => {
    expect(safeRedirect('/dashboard/projects')).toBe('/dashboard/projects');
  });

  it('falls back to /dashboard for unsafe or missing values', () => {
    expect(safeRedirect(null)).toBe('/dashboard');
    expect(safeRedirect('//evil.com')).toBe('/dashboard');
    expect(safeRedirect('https://evil.com')).toBe('/dashboard');
  });

  it('honors a custom fallback', () => {
    expect(safeRedirect('//evil.com', '/onboarding')).toBe('/onboarding');
  });
});
