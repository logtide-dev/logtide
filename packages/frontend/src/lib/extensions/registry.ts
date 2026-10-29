import type { AuthConfig } from '$lib/api/auth';
import { extensions } from './index';
import type { FrontendExtension } from './types';

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
