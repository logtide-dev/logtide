import type { PendingInvitation, OrgRole } from '@logtide/shared';
import { getApiBaseUrl } from '$lib/config';

export interface InviteUserInput {
  email: string;
  role: OrgRole;
}

export interface InviteResult {
  type: 'notification_sent' | 'email_sent';
  message: string;
}

export interface InvitationPreview {
  email: string;
  role: OrgRole;
  organizationName: string;
  inviterName: string;
  expiresAt: Date;
}

export interface AcceptInvitationResult {
  success: boolean;
  organizationId: string;
  role: OrgRole;
}

export class InvitationsAPI {
  constructor(private getToken: () => string | null) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    // Handle 204 No Content responses
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  /**
   * Get invitation preview by token (public, no auth required)
   */
  async getInvitationByToken(token: string): Promise<InvitationPreview> {
    const result = await this.request<any>(`/invitations/token/${token}`);
    return {
      ...result,
      expiresAt: new Date(result.expiresAt),
    };
  }

  /**
   * Accept an invitation (requires auth)
   */
  async acceptInvitation(token: string): Promise<AcceptInvitationResult> {
    return this.request('/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  /**
   * Invite a user to an organization
   */
  async inviteUser(organizationId: string, input: InviteUserInput): Promise<InviteResult> {
    return this.request(`/invitations/${organizationId}/invite`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /**
   * Get pending invitations for an organization
   */
  async getPendingInvitations(organizationId: string): Promise<{ invitations: PendingInvitation[] }> {
    const result = await this.request<{ invitations: any[] }>(`/invitations/${organizationId}/invitations`);
    return {
      invitations: result.invitations.map((inv) => ({
        ...inv,
        expiresAt: new Date(inv.expiresAt),
        createdAt: new Date(inv.createdAt),
      })),
    };
  }

  /**
   * Revoke a pending invitation
   */
  async revokeInvitation(organizationId: string, invitationId: string): Promise<void> {
    await this.request(`/invitations/${organizationId}/invitations/${invitationId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Resend an invitation email
   */
  async resendInvitation(organizationId: string, invitationId: string): Promise<{ success: boolean; message: string }> {
    return this.request(`/invitations/${organizationId}/invitations/${invitationId}/resend`, {
      method: 'POST',
    });
  }
}

// Singleton instance
export const invitationsAPI = new InvitationsAPI(() => {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('logtide_auth');
      if (stored) {
        const data = JSON.parse(stored);
        return data.token;
      }
    } catch (e) {
      console.error('Failed to get token:', e);
    }
  }
  return null;
});
