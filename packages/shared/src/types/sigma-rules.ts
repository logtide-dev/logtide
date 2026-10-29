import type { SigmaLevel, SigmaStatus, PackCategory } from '../constants/sigma-constants.js';

/** Maximum size of a rule YAML document, in bytes (64 KiB). */
export const MAX_RULE_YAML_BYTES = 65536;

/** Time ranges the history preview accepts. */
export const PREVIEW_RANGES = ['24h', '7d'] as const;
export type PreviewRange = (typeof PREVIEW_RANGES)[number];

export type SigmaRuleSource = 'custom' | 'sigmahq' | 'pack';

export type SigmaRuleSortKey = 'title' | 'level' | 'hits7d' | 'lastFiredAt' | 'createdAt';

export interface SigmaRuleListItem {
  id: string;
  organizationId: string;
  projectId: string | null;
  sigmaId: string | null;
  title: string;
  description: string | null;
  author: string | null;
  date: string | null;
  level: SigmaLevel;
  status: SigmaStatus | null;
  logsource: Record<string, unknown>;
  detection: Record<string, unknown>;
  emailRecipients: string[] | null;
  webhookUrl: string | null;
  alertRuleId: string | null;
  conversionStatus: 'success' | 'partial' | 'failed' | null;
  conversionNotes: string | null;
  enabled: boolean;
  tags: string[] | null;
  mitreTactics: string[] | null;
  mitreTechniques: string[] | null;
  sigmahqPath?: string | null;
  createdAt: string;
  updatedAt: string;
  source: SigmaRuleSource;
  packId: string | null;
  hits7d: number;
  lastFiredAt: string | null;
  exceptionCount: number;
}

export interface SigmaRuleDetail extends SigmaRuleListItem {
  yaml: string;
  yamlReconstructed: boolean;
  editable: boolean;
}

export interface SigmaRuleListQuery {
  organizationId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  severity?: SigmaLevel[];
  tactic?: string[];
  source?: SigmaRuleSource[];
  category?: PackCategory[];
  enabled?: boolean;
  projectId?: string;
  sortBy?: SigmaRuleSortKey;
  sortOrder?: 'asc' | 'desc';
}

export type ExceptionOperator = 'equals' | 'contains' | 'in';

export interface ExceptionCondition {
  field: string;
  operator: ExceptionOperator;
  values: string[];
}

export interface SigmaException {
  id: string;
  ruleId: string;
  conditions: ExceptionCondition[];
  reason: string | null;
  expiresAt: string | null;
  hitCount: number;
  lastHitAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface SigmaPreviewSample {
  id: string;
  time: string;
  projectId: string;
  service: string;
  level: string;
  message: string;
  matchedFields: Record<string, unknown>;
}

export interface SigmaRulePreviewResult {
  range: PreviewRange;
  from: string;
  to: string;
  scanned: number;
  matches: number;
  suppressed: number;
  truncated: boolean;
  truncatedReason: 'max_logs' | 'timeout' | null;
  samples: SigmaPreviewSample[];
}
