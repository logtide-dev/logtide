import type { SigmaLevel, SigmaStatus, PackCategory } from '../constants/sigma-constants.js';

export interface SigmaLogsource {
  product?: string;
  service?: string;
  category?: string;
}

export interface SigmaDetection {
  condition: string;
  [key: string]: unknown;
}

export interface DetectionPackRule {
  id: string;
  name: string;
  description: string;
  logsource: SigmaLogsource;
  detection: SigmaDetection;
  level: SigmaLevel;
  status: SigmaStatus;
  tags?: string[];
  references?: string[];
}

export interface DetectionPack {
  id: string;
  name: string;
  description: string;
  category: PackCategory;
  icon: string;
  rules: DetectionPackRule[];
  author?: string;
  version?: string;
}

export interface ThresholdOverride {
  level?: SigmaLevel;
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
  activatedAt: Date | string;
  updatedAt: Date | string;
}

export interface DetectionPackWithStatus extends DetectionPack {
  enabled: boolean;
  activatedAt: string | null;
  customThresholds: ThresholdMap | null;
  generatedRulesCount: number;
}

export interface EnablePackInput {
  organizationId: string;
  customThresholds?: ThresholdMap;
  emailRecipients?: string[];
  webhookUrl?: string | null;
}

export interface UpdateThresholdsInput {
  organizationId: string;
  customThresholds: ThresholdMap;
}
