export type BuiltinParser = 'nginx' | 'apache' | 'syslog' | 'logfmt' | 'odoo' | 'json';

export interface ParserStep {
  type: 'parser';
  parser: BuiltinParser;
}

export interface GrokStep {
  type: 'grok';
  pattern: string;
  source?: string; // field to parse, default 'message'
}

export interface GeoIpStep {
  type: 'geoip';
  field: string;   // metadata field containing the IP
  target: string;  // output metadata key (e.g. 'geo')
}

export type PipelineStep = ParserStep | GrokStep | GeoIpStep;

export interface Pipeline {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  steps: PipelineStep[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePipelineInput {
  organizationId: string;
  projectId?: string | null;
  name: string;
  description?: string;
  enabled?: boolean;
  steps: PipelineStep[];
}

export interface UpdatePipelineInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  steps?: PipelineStep[];
}

/** Input to the pipeline executor - one log entry */
export interface LogForPipeline {
  id: string;
  time: Date;
  message: string;
  metadata: Record<string, unknown> | null;
}

/** Output: fields to merge into the log's metadata */
export type ExtractedFields = Record<string, unknown>;

export interface StepResult {
  step: PipelineStep;
  extracted: ExtractedFields;
  error?: string;
}

export interface ExecutorResult {
  steps: StepResult[];
  merged: ExtractedFields; // union of all extracted fields
}
