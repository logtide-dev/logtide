import { describe, it, expect } from 'vitest';
import type { InstanceSettingsForm } from '$lib/utils/admin-settings';
import { isSectionDirty, sectionPayload, isEnablingAuthFree, resetSection } from './settings-sections';

const base: InstanceSettingsForm = {
  signupEnabled: true,
  authMode: 'standard',
  defaultUserId: null,
  updatesChannel: 'stable',
};

describe('settings sections', () => {
  it('detects dirtiness per section only', () => {
    const cur = { ...base, signupEnabled: false };
    expect(isSectionDirty('signups', base, cur)).toBe(true);
    expect(isSectionDirty('auth', base, cur)).toBe(false);
    expect(isSectionDirty('updates', base, cur)).toBe(false);
    expect(isSectionDirty('auth', base, { ...base, defaultUserId: 'u1' })).toBe(true);
  });

  it('builds payloads with only the section keys', () => {
    expect(Object.keys(sectionPayload('signups', base))).toEqual(['auth.signup_enabled']);
    expect(Object.keys(sectionPayload('auth', base)).sort()).toEqual(['auth.default_user_id', 'auth.mode']);
    expect(sectionPayload('updates', { ...base, updatesChannel: 'beta' })).toEqual({ 'updates.channel': 'beta' });
  });

  it('detects enabling auth-free mode', () => {
    expect(isEnablingAuthFree(base, { ...base, authMode: 'none' })).toBe(true);
    expect(isEnablingAuthFree({ ...base, authMode: 'none' }, { ...base, authMode: 'none' })).toBe(false);
    expect(isEnablingAuthFree({ ...base, authMode: 'none' }, base)).toBe(false);
  });

  it('resets one section without touching others', () => {
    const cur = { ...base, signupEnabled: false, updatesChannel: 'beta' as const };
    const next = resetSection('signups', base, cur);
    expect(next.signupEnabled).toBe(true);
    expect(next.updatesChannel).toBe('beta');
  });
});
