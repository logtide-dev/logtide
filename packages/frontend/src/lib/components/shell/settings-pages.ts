/**
 * Settings pages for the command palette. Built from the same list as the settings
 * sidebar (settings-nav.ts), so names, routes and role visibility never drift.
 */
import { activeExtensions } from '$lib/extensions/registry';
import { visibleSettingsGroups, type SettingsNavContext } from '$lib/components/settings/settings-nav';

export interface SettingsPage {
  label: string;
  href: string;
  keywords: string[];
}

/** Extra search words per settings nav item id. */
const KEYWORDS: Record<string, string[]> = {
  'account-profile': ['account', 'name', 'email', 'avatar'],
  'account-preferences': ['account', 'display', 'time zone', 'timezone', 'clock', 'theme'],
  'account-security': ['account', 'password', 'sessions', 'two factor'],
  general: ['organization', 'name', 'slug', 'retention'],
  members: ['team', 'invite', 'roles', 'users'],
  usage: ['quota', 'limits', 'plan'],
  'audit-log': ['history', 'activity', 'changes'],
  'pii-masking': ['privacy', 'redact', 'sensitive'],
  pipelines: ['parsing', 'enrichment', 'geoip'],
  patterns: ['identifiers', 'correlation', 'extract'],
  'notification-destinations': ['email', 'slack', 'webhook', 'channels'],
  'notification-routing': ['rules', 'who gets notified'],
  'notification-digests': ['summary', 'report', 'email'],
  'notification-delivery-log': ['notifications', 'history', 'failed'],
};

/** Settings pages visible to the viewer, named exactly like the settings sidebar. */
export function settingsPages(ctx: SettingsNavContext): SettingsPage[] {
  const extensionKeywords = new Map<string, string[]>();
  for (const ext of activeExtensions(ctx.authConfig, ctx.extensionList)) {
    for (const item of ext.settingsNav ?? []) extensionKeywords.set(item.id, item.keywords ?? []);
  }
  return visibleSettingsGroups(ctx)
    .filter((group) => group.label !== 'Projects')
    .flatMap((group) =>
      group.items.map((item) => ({
        label: item.label,
        href: item.href,
        keywords: [group.label.toLowerCase(), ...(KEYWORDS[item.id] ?? extensionKeywords.get(item.id) ?? [])],
      }))
    );
}
