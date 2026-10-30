import { describe, it, expect } from 'vitest';
import type { UserBasic } from '$lib/api/admin';
import { defaultUserOptions, settingsFromResponse, settingsPayload, validateSettings } from './admin-settings';

function user(id: string, extra: Partial<UserBasic> = {}): UserBasic {
    return {
        id,
        email: `${id}@test.com`,
        name: id,
        is_admin: true,
        disabled: false,
        created_at: '2026-01-01T00:00:00Z',
        last_login: null,
        ...extra,
    } as UserBasic;
}

describe('settingsFromResponse', () => {
    it('reads saved values with safe defaults', () => {
        expect(settingsFromResponse({})).toEqual({
            signupEnabled: true,
            authMode: 'standard',
            defaultUserId: null,
            updatesChannel: 'stable',
        });
        expect(
            settingsFromResponse({
                'auth.signup_enabled': false,
                'auth.mode': 'none',
                'auth.default_user_id': 'u1',
                'updates.channel': 'beta',
            })
        ).toEqual({ signupEnabled: false, authMode: 'none', defaultUserId: 'u1', updatesChannel: 'beta' });
    });
});

describe('settingsPayload', () => {
    it('never sends the search settings', () => {
        const body = settingsPayload({ signupEnabled: true, authMode: 'standard', defaultUserId: null, updatesChannel: 'stable' });
        expect(Object.keys(body).sort()).toEqual([
            'auth.default_user_id',
            'auth.mode',
            'auth.signup_enabled',
            'updates.channel',
        ]);
    });
});

describe('validateSettings', () => {
    it('blocks auth-free mode without a default user', () => {
        expect(validateSettings({ signupEnabled: true, authMode: 'none', defaultUserId: null, updatesChannel: 'stable' })).toMatch(
            /default user/
        );
        expect(validateSettings({ signupEnabled: true, authMode: 'none', defaultUserId: 'u1', updatesChannel: 'stable' })).toBeNull();
        expect(validateSettings({ signupEnabled: true, authMode: 'standard', defaultUserId: null, updatesChannel: 'stable' })).toBeNull();
    });
});

describe('defaultUserOptions', () => {
    it('keeps only active admins', () => {
        const opts = defaultUserOptions([user('a'), user('b', { is_admin: false }), user('c', { disabled: true })], null);
        expect(opts.map((u) => u.id)).toEqual(['a']);
    });

    it('includes the saved user even when it is outside the candidate set', () => {
        const saved = user('z', { is_admin: false });
        const opts = defaultUserOptions([user('a')], saved);
        expect(opts.map((u) => u.id)).toEqual(['z', 'a']);
    });

    it('does not duplicate the saved user', () => {
        const opts = defaultUserOptions([user('a')], user('a'));
        expect(opts.map((u) => u.id)).toEqual(['a']);
    });
});
