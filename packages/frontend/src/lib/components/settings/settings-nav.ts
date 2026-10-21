import type { OrgRole } from '@logtide/shared';
import { canManageMembers } from '@logtide/shared';
import User from '@lucide/svelte/icons/user';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import KeyRound from '@lucide/svelte/icons/key-round';
import Building2 from '@lucide/svelte/icons/building-2';
import Users from '@lucide/svelte/icons/users';
import CreditCard from '@lucide/svelte/icons/credit-card';
import ChartColumn from '@lucide/svelte/icons/chart-column';
import ClipboardList from '@lucide/svelte/icons/clipboard-list';
import ShieldAlert from '@lucide/svelte/icons/shield-alert';
import GitBranch from '@lucide/svelte/icons/git-branch';
import Fingerprint from '@lucide/svelte/icons/fingerprint';
import BellRing from '@lucide/svelte/icons/bell-ring';
import Route from '@lucide/svelte/icons/route';
import Newspaper from '@lucide/svelte/icons/newspaper';
import Send from '@lucide/svelte/icons/send';
import FolderKanban from '@lucide/svelte/icons/folder-kanban';

export type SettingsNavItem = {
  id: string;
  label: string;
  href: string;
  icon: typeof Building2;
  adminOnly?: boolean;
  requiresBilling?: boolean;
  appliesTo: 'you' | 'organization' | 'project';
};

export type SettingsNavGroup = {
  label: string;
  items: SettingsNavItem[];
};

export const SETTINGS_GROUPS: SettingsNavGroup[] = [
  {
    label: 'Account',
    items: [
      { id: 'account-profile', label: 'Profile', href: '/dashboard/settings/account/profile', icon: User, appliesTo: 'you' },
      { id: 'account-preferences', label: 'Preferences', href: '/dashboard/settings/account/preferences', icon: SlidersHorizontal, appliesTo: 'you' },
      { id: 'account-security', label: 'Security', href: '/dashboard/settings/account/security', icon: KeyRound, appliesTo: 'you' },
    ],
  },
  {
    label: 'Organization',
    items: [
      { id: 'general', label: 'General', href: '/dashboard/settings/general', icon: Building2, appliesTo: 'organization' },
      { id: 'members', label: 'Members', href: '/dashboard/settings/members', icon: Users, appliesTo: 'organization' },
      { id: 'billing', label: 'Billing', href: '/dashboard/settings/billing', icon: CreditCard, adminOnly: true, requiresBilling: true, appliesTo: 'organization' },
      { id: 'usage', label: 'Usage', href: '/dashboard/settings/usage', icon: ChartColumn, appliesTo: 'organization' },
      { id: 'audit-log', label: 'Audit log', href: '/dashboard/settings/audit-log', icon: ClipboardList, adminOnly: true, appliesTo: 'organization' },
    ],
  },
  {
    label: 'Data',
    items: [
      { id: 'pii-masking', label: 'PII masking', href: '/dashboard/settings/pii-masking', icon: ShieldAlert, appliesTo: 'organization' },
      { id: 'pipelines', label: 'Pipelines', href: '/dashboard/settings/pipelines', icon: GitBranch, appliesTo: 'organization' },
      { id: 'patterns', label: 'Identifier extraction', href: '/dashboard/settings/patterns', icon: Fingerprint, appliesTo: 'organization' },
    ],
  },
  {
    label: 'Notifications',
    items: [
      { id: 'notification-destinations', label: 'Destinations', href: '/dashboard/settings/notifications/destinations', icon: BellRing, appliesTo: 'organization' },
      { id: 'notification-routing', label: 'Routing', href: '/dashboard/settings/notifications/routing', icon: Route, appliesTo: 'organization' },
      { id: 'notification-digests', label: 'Digests', href: '/dashboard/settings/notifications/digests', icon: Newspaper, appliesTo: 'organization' },
      { id: 'notification-delivery-log', label: 'Delivery log', href: '/dashboard/settings/notifications/delivery-log', icon: Send, appliesTo: 'organization' },
    ],
  },
  {
    label: 'Projects',
    items: [
      { id: 'projects', label: 'Projects', href: '/dashboard/projects', icon: FolderKanban, appliesTo: 'organization' },
    ],
  },
];

export interface SettingsNavContext {
  role?: OrgRole | null;
  billingEnabled: boolean;
}

/** Whether one item is visible for the viewer. Unknown role is treated as plain member. */
export function isSettingsItemVisible(item: SettingsNavItem, ctx: SettingsNavContext): boolean {
  if (item.adminOnly && !(ctx.role && canManageMembers(ctx.role))) return false;
  if (item.requiresBilling && !ctx.billingEnabled) return false;
  return true;
}

/** Groups with only the visible items; groups that end up empty are dropped. */
export function visibleSettingsGroups(ctx: SettingsNavContext): SettingsNavGroup[] {
  return SETTINGS_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((item) => isSettingsItemVisible(item, ctx)),
  })).filter((g) => g.items.length > 0);
}

/** Flattened visible items, also consumed by the command palette. */
export function visibleSettingsItems(ctx: SettingsNavContext): SettingsNavItem[] {
  return visibleSettingsGroups(ctx).flatMap((g) => g.items);
}
