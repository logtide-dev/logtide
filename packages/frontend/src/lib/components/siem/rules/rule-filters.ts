export interface RuleFilterValue {
  q: string;
  severity: string[];
  tactic: string[];
  source: string[];
  enabled: 'all' | 'true' | 'false';
}

export const EMPTY_RULE_FILTERS: RuleFilterValue = {
  q: '',
  severity: [],
  tactic: [],
  source: [],
  enabled: 'all',
};
