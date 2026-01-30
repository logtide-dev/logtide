// Re-export from shared for convenience
export type { SigmaLevel, SigmaStatus, PackCategory } from '@logtide/shared';
import type { SigmaLevel, SigmaStatus, PackCategory } from '@logtide/shared';

export interface SigmaLogsource {
  product?: string;
  service?: string;
  category?: string;
}

export interface SigmaDetection {
  condition: string;
  [key: string]: unknown;
}


/**
 * Sigma-based detection pack rule
 * Each rule represents a Sigma detection pattern
 */
export interface DetectionPackRule {
  id: string;
  name: string;
  description: string;
  // Sigma detection fields
  logsource: SigmaLogsource;
  detection: SigmaDetection;
  level: SigmaLevel;
  status: SigmaStatus;
  // MITRE ATT&CK tags (e.g., ['attack.initial_access', 'attack.t1190'])
  tags?: string[];
  // Optional references (URLs to documentation)
  references?: string[];
}

export interface DetectionPack {
  id: string;
  name: string;
  description: string;
  category: PackCategory;
  icon: string; // lucide icon name
  rules: DetectionPackRule[];
  // Pack author info
  author?: string;
  version?: string;
}

export interface ThresholdOverride {
  // For Sigma rules, we can override the level
  level?: SigmaLevel;
  // And whether to enable email/webhook notifications
  emailEnabled?: boolean;
  webhookEnabled?: boolean;
}

export type ThresholdMap = Record<string, ThresholdOverride>;

export interface PackActivation {
  id: string;
  organizationId: string;
  packId: string;
  enabled: boolean;
  customThresholds: ThresholdMap | null;
  activatedAt: Date;
  updatedAt: Date;
}

export interface DetectionPackWithStatus extends DetectionPack {
  enabled: boolean;
  activatedAt: string | null; // ISO string for JSON serialization
  customThresholds: ThresholdMap | null;
  generatedRulesCount: number;
}
