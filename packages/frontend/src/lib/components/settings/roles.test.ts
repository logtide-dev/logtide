import { describe, it, expect } from 'vitest';
import { canManageMembers } from '@logtide/shared';
import { roleLabel, ROLE_CAPABILITIES } from './roles';

describe('roles', () => {
  it('roleLabel capitalises', () => {
    expect(roleLabel('owner')).toBe('Owner');
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel('member')).toBe('Member');
  });

  it('lists exactly the eight capabilities', () => {
    expect(ROLE_CAPABILITIES.map((c) => c.label)).toEqual([
      'View and use all organization data',
      'Manage members and invitations',
      'Change PII masking, pipelines and identifier extraction',
      'Change status page settings',
      'Manage notification destinations and digests',
      'View the audit log and billing',
      'Edit organization name and URL slug',
      'Invite or promote admins, transfer ownership and delete the organization',
    ]);
  });

  it('agrees with canManageMembers from @logtide/shared', () => {
    const cap = ROLE_CAPABILITIES.find((c) => c.label === 'Manage members and invitations')!;
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(cap.roles.includes(role)).toBe(canManageMembers(role));
    }
  });
});
