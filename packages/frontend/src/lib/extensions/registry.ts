import type { AuthConfig } from '$lib/api/auth';
import { extensions } from './index';
import type { Component } from 'svelte';
import type {
  AdminGroupLabel,
  ExtensionAdminItem,
  ExtensionAdminOrgPanel,
  FrontendExtension,
} from './types';

export function activeExtensions(
  cfg: AuthConfig | null,
  list: FrontendExtension[] = extensions
): FrontendExtension[] {
  if (!cfg) return [];
  return list.filter((ext) => ext.isEnabled(cfg));
}

/** Upgrade target of the first active extension that provides one. */
export function extensionUpgradeTarget(
  cfg: AuthConfig | null,
  list: FrontendExtension[] = extensions
): { href: string } | null {
  for (const ext of activeExtensions(cfg, list)) {
    if (ext.upgradeTarget) return ext.upgradeTarget;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyIcon = Component<any>;

export interface AdminNavGroup {
  label: string;
  items: Array<{ label: string; href: string; icon: AnyIcon }>;
}

export interface AdminPaletteItem {
  id: string;
  label: string;
  href: string;
  icon: AnyIcon;
  keywords: string[];
}

const DEFAULT_ADMIN_GROUP: AdminGroupLabel = 'Cloud';

function ownsHref(ext: FrontendExtension, href: string): boolean {
  const prefix = `/dashboard/admin/ext/${ext.name}`;
  return href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}?`);
}

/** Admin items of the active extensions whose href stays inside their own admin area. */
function activeAdminItems(
  cfg: AuthConfig | null,
  list: FrontendExtension[]
): Array<{ ext: FrontendExtension; item: ExtensionAdminItem }> {
  const out: Array<{ ext: FrontendExtension; item: ExtensionAdminItem }> = [];
  const seen = new Set<string>();
  for (const ext of activeExtensions(cfg, list)) {
    for (const item of ext.adminNav ?? []) {
      if (!ownsHref(ext, item.href)) {
        console.warn(
          `[extensions] ${ext.name}: admin item '${item.id}' ignored, href must start with /dashboard/admin/ext/${ext.name}`
        );
        continue;
      }
      // Navigation lists are keyed by href: a duplicate would break the sidebar.
      if (seen.has(item.href)) {
        console.warn(`[extensions] ${ext.name}: admin item '${item.id}' ignored, duplicate href ${item.href}`);
        continue;
      }
      seen.add(item.href);
      out.push({ ext, item });
    }
  }
  return out;
}

/** Core admin groups with the items of active extensions merged in. `core` is not mutated. */
export function adminNavGroups(
  core: AdminNavGroup[],
  cfg: AuthConfig | null,
  list: FrontendExtension[] = extensions
): AdminNavGroup[] {
  const groups = core.map((g) => ({ label: g.label, items: [...g.items] }));
  for (const { item } of activeAdminItems(cfg, list)) {
    const label = item.group ?? DEFAULT_ADMIN_GROUP;
    let target = groups.find((g) => g.label === label);
    if (!target) {
      target = { label, items: [] };
      groups.push(target);
    }
    const entry = { label: item.label, href: item.href, icon: item.icon };
    const at = item.after ? target.items.findIndex((i) => i.href === item.after) : -1;
    if (at >= 0) target.items.splice(at + 1, 0, entry);
    else target.items.push(entry);
  }
  return groups;
}

/** Command palette entries for the admin pages of active extensions (show to admins only). */
export function adminPaletteItems(
  cfg: AuthConfig | null,
  list: FrontendExtension[] = extensions
): AdminPaletteItem[] {
  return activeAdminItems(cfg, list).map(({ item }) => ({
    id: item.id,
    label: item.label,
    href: item.href,
    icon: item.icon,
    keywords: ['admin', (item.group ?? DEFAULT_ADMIN_GROUP).toLowerCase(), ...(item.keywords ?? [])],
  }));
}

/** Organization page sections of active extensions, with their page anchor. */
export function adminOrgPanels(
  cfg: AuthConfig | null,
  list: FrontendExtension[] = extensions
): Array<ExtensionAdminOrgPanel & { anchor: string }> {
  const out: Array<ExtensionAdminOrgPanel & { anchor: string }> = [];
  const seen = new Set<string>();
  for (const ext of activeExtensions(cfg, list)) {
    for (const panel of ext.adminOrgPanels ?? []) {
      const anchor = `ext-${ext.name}-${panel.id}`;
      // Sections are keyed by anchor: a duplicate would break the organization page.
      if (seen.has(anchor)) {
        console.warn(`[extensions] ${ext.name}: organization panel '${panel.id}' ignored, duplicate id`);
        continue;
      }
      seen.add(anchor);
      out.push({ ...panel, anchor });
    }
  }
  return out;
}

/**
 * Whether any registered extension contributes admin pages or organization
 * panels. False in the public build, so the admin screens skip the auth
 * config request and behave exactly as without extensions.
 */
export function hasAdminContributions(list: FrontendExtension[] = extensions): boolean {
  return list.some((ext) => (ext.adminNav?.length ?? 0) > 0 || (ext.adminOrgPanels?.length ?? 0) > 0);
}
