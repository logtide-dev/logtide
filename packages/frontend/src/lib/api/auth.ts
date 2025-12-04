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
}

export const authAPI = new AuthAPI();
