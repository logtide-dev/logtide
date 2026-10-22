/**
 * Static list of settings pages for the command palette. Re-check against the
 * W11/W14 final routes in Wave D.
 */
export interface SettingsPage {
  label: string;
  href: string;
  keywords: string[];
}

export const SETTINGS_PAGES: SettingsPage[] = [
  { label: 'General settings', href: '/dashboard/settings/general', keywords: ['organization', 'name', 'retention', 'display'] },
  { label: 'Members', href: '/dashboard/settings/members', keywords: ['team', 'invite', 'roles', 'users'] },
  { label: 'Audit log', href: '/dashboard/settings/audit-log', keywords: ['history', 'activity', 'changes'] },
  { label: 'PII masking', href: '/dashboard/settings/pii-masking', keywords: ['privacy', 'redact', 'sensitive'] },
  { label: 'Pipelines', href: '/dashboard/settings/pipelines', keywords: ['parsing', 'enrichment', 'geoip'] },
  { label: 'Patterns', href: '/dashboard/settings/patterns', keywords: ['grouping', 'log patterns'] },
  { label: 'Notification destinations', href: '/dashboard/settings/notifications/destinations', keywords: ['email', 'slack', 'webhook', 'channels'] },
  { label: 'Notification routing', href: '/dashboard/settings/notifications/routing', keywords: ['rules', 'who gets notified'] },
  { label: 'Notification digests', href: '/dashboard/settings/notifications/digests', keywords: ['summary', 'report', 'email'] },
  { label: 'Delivery log', href: '/dashboard/settings/notifications/delivery-log', keywords: ['notifications', 'history', 'failed'] },
  { label: 'Account settings', href: '/dashboard/account', keywords: ['profile', 'password', 'preferences'] },
];
