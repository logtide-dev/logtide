import type { Component } from 'svelte';
import type { AuthConfig } from '$lib/api/auth';
import type { SettingsNavItem } from '$lib/components/settings/settings-nav';

export type SettingsGroupLabel = 'Account' | 'Organization' | 'Data' | 'Notifications';

export interface ExtensionSettingsItem extends SettingsNavItem {
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
  /** Pages added to the instance admin navigation (admins only). */
  adminNav?: ExtensionAdminItem[];
  /** Sections added to the instance admin organization page. */
  adminOrgPanels?: ExtensionAdminOrgPanel[];
}

/** Admin navigation groups; 'Cloud' holds extension pages by default. */
export type AdminGroupLabel = 'Instance' | 'Manage' | 'Cloud';

export interface ExtensionAdminItem {
  id: string;
  label: string;
  /** Must start with `/dashboard/admin/ext/<extension name>`; other items are dropped. */
  href: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: Component<any>;
  /** Default 'Cloud'. */
  group?: AdminGroupLabel;
  /** href of a core item of the group to insert after; absent or unknown = end of the group. */
  after?: string;
  /** Extra command palette search words. */
  keywords?: string[];
}

export interface ExtensionAdminOrgPanel {
  /** Section id; the page anchor is `ext-<extension name>-<id>`. */
  id: string;
  /** Label in the organization section navigation. */
  label: string;
  component: Component<{ orgId: string }>;
}
