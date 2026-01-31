const AUTH_STORAGE_KEY = 'logtide_auth';

export function getAuthToken(): string | null {
	if (typeof window === 'undefined') {
		return null;
	}
	try {
		const stored = localStorage.getItem(AUTH_STORAGE_KEY);
		if (stored) {
			const data = JSON.parse(stored);
			return data.token;
		}
	} catch {
		// Ignore parse errors
	}
	return null;
}
