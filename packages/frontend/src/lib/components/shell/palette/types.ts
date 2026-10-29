import type { Component } from 'svelte';

export interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  icon?: Component<any>;
  /** Navigates with goto when selected */
  href?: string;
  /** Runs when selected (used when there is no href) */
  onSelect?: () => void;
  /** Raw key combo such as 'g l'; the palette formats it for display */
  shortcut?: string;
  keywords?: string[];
}

export interface PaletteContext {
  organizationId: string | null;
  projectId: string | null;
  signal: AbortSignal;
}

export interface PaletteProvider {
  id: string;
  /** Group heading, sentence case */
  heading: string;
  order: number;
  /** Cache lifetime per organization. 0 disables caching. Default 60000. */
  ttlMs?: number;
  /** Skipped when no organization is selected. */
  needsOrganization?: boolean;
  items(ctx: PaletteContext): PaletteItem[] | Promise<PaletteItem[]>;
}

export interface PaletteGroup {
  provider: string;
  heading: string;
  items: PaletteItem[];
  failed?: boolean;
}
