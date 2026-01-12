/**
 * Sigma Rule Types
 * Based on Sigma specification: https://github.com/SigmaHQ/sigma-specification
 */

export interface SigmaRule {
  // Required fields
  title: string;
  detection: SigmaDetection;
  logsource: SigmaLogSource;

  // Optional metadata
  id?: string; // UUID or custom identifier
  status?: 'experimental' | 'test' | 'stable' | 'deprecated' | 'unsupported';
  description?: string;
  author?: string;
  date?: string; // YYYY-MM-DD format
  modified?: string;
  level?: 'informational' | 'low' | 'medium' | 'high' | 'critical';
  tags?: string[];
  references?: string[];
  falsepositives?: string[];

  // Additional fields
  [key: string]: any;
}

export interface SigmaLogSource {
  product?: string; // windows, linux, macos, etc.
  service?: string; // sysmon, powershell, etc.
  category?: string; // process_creation, network_connection, etc.
  definition?: string;

  [key: string]: any;
}

export interface SigmaDetection {
  condition: string | string[];

  // Dynamic selection fields
  [key: string]: any;
}

export interface SigmaSelection {
  [field: string]: string | number | boolean | string[] | number[] | null;
}

/**
 * Parsed and validated Sigma Rule (internal representation)
 */
export interface ParsedSigmaRule extends SigmaRule {
  // Normalized fields
  id: string;
  level: 'informational' | 'low' | 'medium' | 'high' | 'critical';
  status: 'experimental' | 'test' | 'stable' | 'deprecated' | 'unsupported';
}

/**
 * Conversion result from Sigma to LogTide Alert Rule
 */
export interface SigmaConversionResult {
  success: boolean;
  alertRule?: {
    name: string;
    enabled: boolean;
    service?: string;
    level: string[];
    threshold: number;
    timeWindow: number;
    emailRecipients: string[];
    webhookUrl?: string;
    metadata?: Record<string, any>;
  };
  warnings: string[];
  errors: string[];
  conversionNotes: string;
}

/**
 * Database representation
 */
export interface SigmaRuleRecord {
  id: string;
  organizationId: string;
  projectId?: string;

  // Sigma metadata
  sigmaId?: string;
  title: string;
  description?: string;
  author?: string;
  date?: Date;
  level?: string;
  status?: string;

  // Detection
  logsource: Record<string, any>;
  detection: Record<string, any>;

  // Notifications (independent from alert rules)
  emailRecipients?: string[];
  webhookUrl?: string;

  // Conversion
  alertRuleId?: string;
  conversionStatus?: 'success' | 'partial' | 'failed';
  conversionNotes?: string;

  // Phase 3: SigmaHQ integration
  tags?: string[];
  mitreTactics?: string[];
  mitreTechniques?: string[];
  sigmahqPath?: string;
  sigmahqCommit?: string;
  lastSyncedAt?: Date;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
