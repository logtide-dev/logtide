import type { OrgRole } from '@logtide/shared';

export type RoleLabel = 'Owner' | 'Admin' | 'Member';

export function roleLabel(role: OrgRole): RoleLabel {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  return 'Member';
}

export interface RoleCapability {
  id: string;
  label: string;
  roles: OrgRole[];
}

export const ROLE_CAPABILITIES: RoleCapability[] = [
  { id: 'use-data', label: 'View and use all organization data', roles: ['owner', 'admin', 'member'] },
  { id: 'manage-members', label: 'Manage members and invitations', roles: ['owner', 'admin'] },
  { id: 'data-config', label: 'Change PII masking, pipelines and identifier extraction', roles: ['owner', 'admin'] },
  { id: 'status-page', label: 'Change status page settings', roles: ['owner', 'admin'] },
  { id: 'notifications', label: 'Manage notification destinations and digests', roles: ['owner', 'admin'] },
  { id: 'audit-billing', label: 'View the audit log and billing', roles: ['owner', 'admin'] },
  { id: 'org-identity', label: 'Edit organization name and URL slug', roles: ['owner'] },
  { id: 'owner-actions', label: 'Invite or promote admins, transfer ownership and delete the organization', roles: ['owner'] },
];
