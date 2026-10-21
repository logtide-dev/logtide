import type { SigmaRuleSource } from '@logtide/shared';
import { DETECTION_PACKS } from '../detection-packs/pack-definitions.js';

/** Pack ids, longest first so a prefix collision resolves to the longest id. */
const PACK_IDS_LONGEST_FIRST = DETECTION_PACKS.map((p) => p.id).sort((a, b) => b.length - a.length);

/**
 * The detection pack a rule was generated from, derived from its sigma_id
 * (`pack-<packId>-<ruleId>`). Null for every other rule. Mirrors the SQL
 * `sigma_id LIKE 'pack-<packId>-%'` used by the list source filter.
 */
export function packIdFor(sigmaId: string | null | undefined): string | null {
  if (!sigmaId) return null;
  for (const id of PACK_IDS_LONGEST_FIRST) {
    if (sigmaId.startsWith(`pack-${id}-`)) return id;
  }
  return null;
}

/** pack = generated from code, sigmahq = synced from SigmaHQ, custom = the rest. */
export function classifySource(row: {
  sigma_id?: string | null;
  sigmahq_path?: string | null;
}): SigmaRuleSource {
  if (packIdFor(row.sigma_id)) return 'pack';
  if (row.sigmahq_path) return 'sigmahq';
  return 'custom';
}

/** LIKE patterns matching every known pack rule sigma_id. */
export function packSigmaIdPatterns(): string[] {
  return DETECTION_PACKS.map((p) => `pack-${p.id}-%`);
}
