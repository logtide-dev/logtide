import type { UserBasic } from '$lib/api/admin';

export type AuthMode = 'standard' | 'none';
export type UpdatesChannel = 'stable' | 'beta';

/** Instance settings the admin settings page reads and writes. */
export interface InstanceSettingsForm {
    signupEnabled: boolean;
    authMode: AuthMode;
    defaultUserId: string | null;
    updatesChannel: UpdatesChannel;
}

/** Read the form state from a GET/PATCH settings payload. */
export function settingsFromResponse(settings: Record<string, unknown>): InstanceSettingsForm {
    return {
        signupEnabled: (settings['auth.signup_enabled'] as boolean | undefined) ?? true,
        authMode: settings['auth.mode'] === 'none' ? 'none' : 'standard',
        defaultUserId: (settings['auth.default_user_id'] as string | null | undefined) ?? null,
        updatesChannel: settings['updates.channel'] === 'beta' ? 'beta' : 'stable',
    };
}

/**
 * Body for PATCH /admin/settings. Only keys the backend stores are sent:
 * the search settings shown on the page are not persisted server-side.
 */
export function settingsPayload(form: InstanceSettingsForm): Record<string, unknown> {
    return {
        'auth.signup_enabled': form.signupEnabled,
        'auth.mode': form.authMode,
        'auth.default_user_id': form.defaultUserId,
        'updates.channel': form.updatesChannel,
    };
}

/** Error text when the form cannot be saved, or null when it can. */
export function validateSettings(form: InstanceSettingsForm): string | null {
    if (form.authMode === 'none' && !form.defaultUserId) {
        return 'Select a default user before enabling auth-free mode';
    }
    return null;
}

/**
 * Options for the default-user select: active admins, plus the currently
 * saved user even when it is outside that set (or outside the first page),
 * so the saved value is shown instead of being silently replaced.
 */
export function defaultUserOptions(candidates: UserBasic[], saved: UserBasic | null): UserBasic[] {
    const options = candidates.filter((u) => !u.disabled && u.is_admin);
    if (saved && !options.some((u) => u.id === saved.id)) {
        options.unshift(saved);
    }
    return options;
}
