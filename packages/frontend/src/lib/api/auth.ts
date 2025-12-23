import { getApiBaseUrl } from '$lib/config';

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
  };
  session: {
    token: string;
    expiresAt: string;
  };
}

export interface ErrorResponse {
  error: string;
  details?: any;
}

export interface AuthProvider {
  id: string;
  type: 'local' | 'oidc' | 'ldap';
  name: string;
  slug: string;
  icon: string | null;
  isDefault: boolean;
  displayOrder: number;
  supportsRedirect: boolean;
}

export interface UserIdentity {
  id: string;
  provider: AuthProvider;
  providerUserId: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export class AuthAPI {
  async register(input: RegisterInput): Promise<AuthResponse> {
    const response = await fetch(`${getApiBaseUrl()}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(error.error || 'Registration failed');
    }

    return response.json();
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(error.error || 'Login failed');
    }

    return response.json();
  }

  async logout(token: string): Promise<void> {
    const response = await fetch(`${getApiBaseUrl()}/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(error.error || 'Logout failed');
    }
  }

  async getMe(token: string): Promise<{ user: any }> {
    const response = await fetch(`${getApiBaseUrl()}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(error.error || 'Failed to get user info');
    }

    return response.json();
  }

  // --- External Auth Methods ---

  async getProviders(): Promise<{ providers: AuthProvider[] }> {
    const response = await fetch(`${getApiBaseUrl()}/auth/providers`);

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(error.error || 'Failed to get auth providers');
    }

    return response.json();
  }

  async getOidcAuthorizationUrl(
    providerSlug: string,
    redirectUri?: string
  ): Promise<{ url: string; state: string; provider: string }> {
    const params = new URLSearchParams();
    if (redirectUri) {
      params.set('redirect_uri', redirectUri);
    }

    const response = await fetch(
      `${getApiBaseUrl()}/auth/providers/${providerSlug}/authorize?${params.toString()}`
    );

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(error.error || 'Failed to get authorization URL');
    }

    return response.json();
  }

  async loginWithLdap(
    providerSlug: string,
    username: string,
    password: string
  ): Promise<AuthResponse & { isNewUser: boolean }> {
    const response = await fetch(`${getApiBaseUrl()}/auth/providers/${providerSlug}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(error.error || 'Login failed');
    }

    return response.json();
  }

  async getUserIdentities(token: string): Promise<{ identities: UserIdentity[] }> {
    const response = await fetch(`${getApiBaseUrl()}/auth/me/identities`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(error.error || 'Failed to get identities');
    }

    return response.json();
  }

  async unlinkIdentity(token: string, identityId: string): Promise<void> {
    const response = await fetch(`${getApiBaseUrl()}/auth/me/identities/${identityId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(error.error || 'Failed to unlink identity');
    }
  }
}

export const authAPI = new AuthAPI();
