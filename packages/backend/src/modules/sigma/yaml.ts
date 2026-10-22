import yaml from 'js-yaml';
import { MAX_RULE_YAML_BYTES } from '@logtide/shared';
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

/** Thrown when a rule YAML document exceeds MAX_RULE_YAML_BYTES. */
export class YamlTooLargeError extends Error {
  constructor() {
    super('Rule YAML is larger than 64 KiB');
    this.name = 'YamlTooLargeError';
  }
}

export function assertYamlWithinLimit(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > MAX_RULE_YAML_BYTES) {
    throw new YamlTooLargeError();
  }
}

function isoDay(value: unknown): string | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/**
 * Deterministic YAML for rules that have no stored original text (created
 * before raw YAML was kept, and pack rules generated from code).
 */
export function reconstructYaml(row: {
  title: string;
  sigma_id?: string | null;
  status?: string | null;
  description?: string | null;
  author?: string | null;
  date?: Date | string | null;
  level?: string | null;
  tags?: string[] | null;
  logsource: unknown;
  detection: unknown;
}): string {
  const doc: Record<string, unknown> = {
    title: row.title,
    id: row.sigma_id,
    status: row.status,
    description: row.description,
    author: row.author,
    date: isoDay(row.date),
    level: row.level,
    tags: row.tags && row.tags.length > 0 ? row.tags : undefined,
    logsource: row.logsource,
    detection: row.detection,
  };
  for (const key of Object.keys(doc)) {
    if (doc[key] === undefined || doc[key] === null) delete doc[key];
  }
  return yaml.dump(doc, { noRefs: true, lineWidth: 100, sortKeys: false });
}
