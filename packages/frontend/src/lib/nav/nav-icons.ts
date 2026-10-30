import type { Component } from 'svelte';
import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import FileText from '@lucide/svelte/icons/file-text';
import GitBranch from '@lucide/svelte/icons/git-branch';
import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
import Bug from '@lucide/svelte/icons/bug';
import MonitorPlay from '@lucide/svelte/icons/monitor-play';
import Gauge from '@lucide/svelte/icons/gauge';
import Siren from '@lucide/svelte/icons/siren';
import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
import Activity from '@lucide/svelte/icons/activity';
import Shield from '@lucide/svelte/icons/shield';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import FolderKanban from '@lucide/svelte/icons/folder-kanban';
import Settings from '@lucide/svelte/icons/settings';
import Book from '@lucide/svelte/icons/book';
import Github from '@lucide/svelte/icons/github';
import ServerCog from '@lucide/svelte/icons/server-cog';

const ICONS: Record<string, Component<any>> = {
  dashboards: LayoutDashboard as unknown as Component<any>,
  logs: FileText as unknown as Component<any>,
  traces: GitBranch as unknown as Component<any>,
  metrics: BarChart3 as unknown as Component<any>,
  errors: Bug as unknown as Component<any>,
  sessions: MonitorPlay as unknown as Component<any>,
  'web-vitals': Gauge as unknown as Component<any>,
  incidents: Siren as unknown as Component<any>,
  alerts: AlertTriangle as unknown as Component<any>,
  uptime: Activity as unknown as Component<any>,
  'security-overview': Shield as unknown as Component<any>,
  'security-rules': ShieldCheck as unknown as Component<any>,
  projects: FolderKanban as unknown as Component<any>,
  settings: Settings as unknown as Component<any>,
  docs: Book as unknown as Component<any>,
  github: Github as unknown as Component<any>,
  admin: ServerCog as unknown as Component<any>,
};

/** Icon component for a nav item id. Unknown ids fall back to the dashboards icon. */
export function navIcon(id: string): Component<any> {
  return ICONS[id] ?? ICONS.dashboards;
}
