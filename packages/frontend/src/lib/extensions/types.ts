import type { AuthConfig } from '$lib/api/auth';
import type { SettingsNavItem } from '$lib/components/settings/settings-nav';

export type SettingsGroupLabel = 'Account' | 'Organization' | 'Data' | 'Notifications';

export interface ExtensionSettingsItem extends Omit<SettingsNavItem, 'requiresBilling'> {
  group: SettingsGroupLabel;
  /** Id of the core item to insert after. Absent means the end of the group. */
  after?: string;
  /** Extra command palette search words. */
  keywords?: string[];
}

export interface FrontendExtension {
  name: string;
  isEnabled(cfg: AuthConfig): boolean;
  settingsNav?: ExtensionSettingsItem[];
  /** Where the Usage page Upgrade / Manage billing buttons point. */
  upgradeTarget?: { href: string };
}
