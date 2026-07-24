import type { AuditCategory } from '../../database/types.js';

/**
 * Canonical audit action namespace (issue #217).
 * One entry per security-relevant action; the value is the category the
 * action belongs to. Action names are `family.verb`. Adding an action here
 * is the ONLY way to make it recordable: typos fail to compile at callsites.
 */
export const AUDIT_ACTIONS = {
  // organizations
  'org.created': 'config_change',
  'org.updated': 'config_change',
  'org.deleted': 'data_modification',
  'org.entitlements_updated': 'config_change',
  'org.retention_updated': 'config_change',
  // projects
  'project.created': 'config_change',
  'project.updated': 'config_change',
  'project.deleted': 'data_modification',
  'project.soft_delete': 'data_modification',
  'project.restored': 'data_modification',
  'project.hard_delete': 'data_modification',
  // api keys
  'apikey.created': 'config_change',
  'apikey.revoked': 'config_change',
  // inbound webhook receivers (#155)
  'receiver.created': 'config_change',
  'receiver.deleted': 'config_change',
  // users and membership
  'user.registered': 'user_management',
  'user.created': 'user_management',
  'user.invited': 'user_management',
  'user.invite_accepted': 'user_management',
  'user.invite_revoked': 'user_management',
  'user.invite_resent': 'user_management',
  'user.removed': 'user_management',
  'user.role_changed': 'user_management',
  'user.left': 'user_management',
  'user.disabled': 'user_management',
  'user.enabled': 'user_management',
  'user.password_reset': 'user_management',
  'user.profile_updated': 'user_management',
  'user.deleted': 'user_management',
  'user.identity_linked': 'user_management',
  'user.identity_unlinked': 'user_management',
  // detection / alerting / masking rules (target.type disambiguates:
  // sigma_rule | alert_rule | pii_masking_rule)
  'rule.created': 'config_change',
  'rule.updated': 'config_change',
  'rule.deleted': 'config_change',
  'rule.enabled': 'config_change',
  'rule.disabled': 'config_change',
  'rule.imported': 'config_change',
  // log pipelines
  'pipeline.created': 'config_change',
  'pipeline.updated': 'config_change',
  'pipeline.deleted': 'config_change',
  'pipeline.imported': 'config_change',
  // custom dashboards
  'dashboard.created': 'config_change',
  'dashboard.updated': 'config_change',
  'dashboard.deleted': 'config_change',
  'dashboard.imported': 'config_change',
  // notification channels
  'channel.created': 'config_change',
  'channel.updated': 'config_change',
  'channel.deleted': 'config_change',
  // email digest reports (#154)
  'digest.config_updated': 'config_change',
  'digest.config_deleted': 'config_change',
  'digest.recipient_added': 'config_change',
  'digest.recipient_removed': 'config_change',
  'digest.recipient_resubscribed': 'config_change',
  // webhooks
  'webhook.delivery_replayed': 'config_change',
  // auth
  'auth.login_succeeded': 'user_management',
  'auth.login_failed': 'user_management',
  'auth.session_revoked': 'user_management',
  'auth.provider_created': 'config_change',
  'auth.provider_updated': 'config_change',
  'auth.provider_deleted': 'config_change',
  'auth.providers_reordered': 'config_change',
  // incidents
  'incident.updated': 'config_change',
  'incident.status_changed': 'config_change',
  'incident.deleted': 'data_modification',
  // system settings
  'settings.updated': 'config_change',
  'settings.reset': 'config_change',
  // data access and lifecycle
  'data.logs_searched': 'log_access',
  'data.logs_streamed': 'log_access',
  'data.log_viewed': 'log_access',
  'data.log_context_viewed': 'log_access',
  'data.trace_viewed': 'log_access',
  'data.stats_viewed': 'log_access',
  'data.top_services_viewed': 'log_access',
  'data.top_errors_viewed': 'log_access',
  'data.services_listed': 'log_access',
  'data.hostnames_listed': 'log_access',
  'data.sessions_listed': 'log_access',
  'data.session_events_viewed': 'log_access',
  'data.exported': 'log_access',
  'data.deleted': 'data_modification',
} as const satisfies Record<string, AuditCategory>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export function categoryFor(action: AuditAction): AuditCategory {
  return AUDIT_ACTIONS[action];
}

export function isAuditAction(value: string): value is AuditAction {
  return Object.prototype.hasOwnProperty.call(AUDIT_ACTIONS, value);
}
