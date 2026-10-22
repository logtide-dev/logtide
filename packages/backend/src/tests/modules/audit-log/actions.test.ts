import { describe, it, expect } from 'vitest';
import { AUDIT_ACTIONS, categoryFor, isAuditAction } from '../../../modules/audit-log/actions.js';

const VALID_CATEGORIES = ['log_access', 'config_change', 'user_management', 'data_modification'];

describe('audit action registry', () => {
  it('maps every action to a valid category', () => {
    for (const [action, category] of Object.entries(AUDIT_ACTIONS)) {
      expect(VALID_CATEGORIES).toContain(category);
      expect(action).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it('categoryFor returns the mapped category', () => {
    expect(categoryFor('org.created')).toBe('config_change');
    expect(categoryFor('auth.login_failed')).toBe('user_management');
    expect(categoryFor('data.logs_searched')).toBe('log_access');
    expect(categoryFor('org.deleted')).toBe('data_modification');
  });

  it('isAuditAction guards unknown strings', () => {
    expect(isAuditAction('org.created')).toBe(true);
    expect(isAuditAction('create_api_key')).toBe(false);
  });

  it('covers the issue #217 core namespace', () => {
    const required = [
      'org.created', 'org.updated', 'org.deleted',
      'project.created', 'project.updated', 'project.deleted',
      'apikey.created', 'apikey.revoked',
      'user.invited', 'user.removed', 'user.role_changed',
      'rule.created', 'rule.updated', 'rule.deleted',
      'pipeline.created', 'pipeline.updated', 'pipeline.deleted',
      'dashboard.created', 'dashboard.updated', 'dashboard.deleted',
      'auth.login_succeeded', 'auth.login_failed', 'auth.session_revoked',
      'data.exported', 'data.deleted',
    ];
    for (const a of required) expect(isAuditAction(a)).toBe(true);
  });
});

describe('ownership transfer audit action', () => {
  it('maps org.ownership_transferred to user_management', () => {
    expect(isAuditAction('org.ownership_transferred')).toBe(true);
    expect(categoryFor('org.ownership_transferred')).toBe('user_management');
  });
});
