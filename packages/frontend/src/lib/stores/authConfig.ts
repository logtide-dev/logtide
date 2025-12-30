import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { authAPI, type AuthConfig } from '$lib/api/auth';

interface AuthConfigState {
    authMode: 'standard' | 'none';
    signupEnabled: boolean;
    loaded: boolean;
}

const initialState: AuthConfigState = {
    authMode: 'standard',
    signupEnabled: true,
    loaded: false,
};

function createAuthConfigStore() {
    const { subscribe, set, update } = writable<AuthConfigState>(initialState);

    return {
        subscribe,
        async load() {
            if (!browser) return;

            try {
                const config = await authAPI.getAuthConfig();
                set({
                    authMode: config.authMode,
                    signupEnabled: config.signupEnabled,
                    loaded: true,
                });
            } catch (error) {
                console.error('Failed to load auth config:', error);
                set({
                    authMode: 'standard',
                    signupEnabled: true,
                    loaded: true,
                });
            }
        },
        reset() {
            set(initialState);
        },
    };
}

export const authConfigStore = createAuthConfigStore();
