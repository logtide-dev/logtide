import type { LogLevel } from '../schemas/index.js';

// User types
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  lastLogin?: Date;
}

// Organization types
export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
  ownerId: string;
  retentionDays: number; // 1-365 days, default 90
  createdAt: Date;
  updatedAt: Date;
}

// Organization role type
export type OrgRole = 'owner' | 'admin' | 'member';

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  createdAt: Date;
}

export interface OrganizationMemberWithUser extends OrganizationMember {
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface OrganizationWithRole extends Organization {
  role: OrgRole;
  memberCount?: number;
}

// Invitation types
export interface OrganizationInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: OrgRole;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt?: Date;
  createdAt: Date;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: OrgRole;
  invitedBy: string;
  inviterName: string;
  expiresAt: Date;
  createdAt: Date;
}

// Permission helper
export function canManageMembers(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin';
}

// Project types
export interface Project {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Log types
export interface Log {
  time: Date;
  service: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
  trace_id?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key_hash: string;
  created_at: Date;
  last_used?: Date;
  revoked: boolean;
}

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  service?: string;
  level: LogLevel[];
  threshold: number;
  time_window: number;
  email_recipients: string[];
  webhook_url?: string;
  created_at: Date;
  updated_at: Date;
}
