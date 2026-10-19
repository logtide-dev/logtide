import { capabilities } from '../../capabilities/facade.js';
import {
  CAPABILITIES,
  CAPABILITY_NAMES,
  type CapabilityName,
} from '../../capabilities/registry.js';
import { computeQuotaState, type QuotaState } from '../../capabilities/quota-state.js';
import { meteringService } from './service.js';
import { alertsService } from '../alerts/service.js';
import { apiKeysService } from '../api-keys/service.js';
import { customDashboardsService } from '../custom-dashboards/service.js';
import { projectsService } from '../projects/service.js';
import { notificationChannelsService } from '../notification-channels/service.js';
import { SigmaService } from '../sigma/service.js';
import { readQuotaUsage } from '../../capabilities/quota-usage.js';

const sigmaService = new SigmaService();

export interface CapabilityUsage {
  capability: CapabilityName;
  kind: 'limit' | 'quota';
  /** Current usage: a resource count (limit) or metered consumption (quota). */
  current: number;
  /** Configured cap. null = unlimited (OSS default); render as "no cap", not 0%. */
  limit: number | null;
  description: string;
  /** Quota state (quota kind only): ok | grace | blocked | unlimited. */
  state?: QuotaState;
}

// Current-count resolver per limit capability. audit.retention_days is a config
// ceiling (max days), not a resource count, so it is intentionally omitted - it
// has no meaningful "used vs total" reading.
const LIMIT_COUNTERS: Partial<
  Record<CapabilityName, (orgId: string) => Promise<number>>
> = {
  'alerts.max_rules': (o) => alertsService.countAlertRules(o),
  'notifications.max_channels': (o) => notificationChannelsService.countChannels(o),
  'apikeys.max': (o) => apiKeysService.countKeysForOrg(o),
  'projects.max': (o) => projectsService.countActiveForOrg(o),
  'sigma.max_active_rules': (o) => sigmaService.countActiveRules(o),
  'dashboards.max_custom': (o) => customDashboardsService.countForOrg(o),
};

// Same reader as the QuotaEvaluator: point-in-time gauges read the latest
// snapshot, monthly quotas sum their signal(s) over the current calendar month.
async function quotaUsage(
  organizationId: string,
  cap: CapabilityName,
  now: Date
): Promise<number> {
  const def = CAPABILITIES[cap];
  if (def.kind !== 'quota') return 0;
  return readQuotaUsage(meteringService, organizationId, def, now);
}

/**
 * Live usage vs configured limit for every measurable capability (limit + quota
 * kinds). Boolean gates and audit.retention_days are excluded because they have
 * no "used vs total" reading. A null limit means unlimited; the caller renders
 * that as "no cap" rather than a percentage.
 */
export async function getCapabilityUsage(
  organizationId: string
): Promise<CapabilityUsage[]> {
  const now = new Date();

  const rows = await Promise.all(
    CAPABILITY_NAMES.flatMap((cap) => {
      const def = CAPABILITIES[cap];

      if (def.kind === 'limit') {
        const counter = LIMIT_COUNTERS[cap];
        if (!counter) return [];
        return [
          Promise.all([counter(organizationId), capabilities.getLimit(organizationId, cap)]).then(
            ([current, limit]): CapabilityUsage => ({
              capability: cap,
              kind: 'limit',
              current,
              limit,
              description: def.description,
            })
          ),
        ];
      }

      if (def.kind === 'quota') {
        return [
          Promise.all([
            quotaUsage(organizationId, cap, now),
            capabilities.getLimit(organizationId, cap),
            capabilities.getLimit(organizationId, 'quota.grace_percent'),
          ]).then(
            ([current, limit, grace]): CapabilityUsage => ({
              capability: cap,
              kind: 'quota',
              current,
              limit,
              state: computeQuotaState(current, limit, grace),
              description: def.description,
            })
          ),
        ];
      }

      return [];
    })
  );

  return rows;
}
