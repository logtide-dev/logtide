import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Guard for spec section 3 (sentence case in UI copy) on the static strings
// fixed in 1.6 UI-8. Each entry is a Title Case phrase that must not come back.
// Product names and acronyms (OIDC, LDAP, API, IP, P50) keep their case.
const SRC = path.resolve(__dirname, '../../..');

const TITLE_CASE_LEFTOVERS: Array<[string, string[]]> = [
  ['routes/+error.svelte', ['Page Not Found', 'Something Went Wrong', 'Go Back', 'Debug Info:']],
  ['routes/auth/callback/+page.svelte', ['Authentication Failed', 'Back to Login']],
  ['lib/components/SigmaSyncDialog.svelte', ['Notification Channels (optional)']],
  [
    'lib/components/alerts/preview/PreviewStatistics.svelte',
    ['P50 (Median)', 'By Day of Week', 'Incident Duration'],
  ],
  ['lib/components/siem/enrichment/GeoIpCard.svelte', ['Geographic Data']],
  ['lib/components/siem/enrichment/GeoIpMap.svelte', ['IP Locations']],
  [
    'lib/components/siem/enrichment/IpReputationCard.svelte',
    ['IP Reputation', 'Usage Type', 'Last Checked'],
  ],
  ['lib/components/metrics/GoldenSignalsPanel.svelte', ['All Services']],
  ['lib/utils/golden-signals.ts', ["'Request Rate'", "'Error Rate'"]],
  [
    'routes/dashboard/admin/auth-providers/+page.svelte',
    [
      'OIDC Configuration',
      'LDAP Configuration',
      'Create Provider',
      'Edit Provider:',
      'Save Changes',
    ],
  ],
  [
    'routes/dashboard/admin/settings/+page.svelte',
    [
      'Standard Authentication',
      'Auth-Free Mode',
      'User Registration',
      'Authentication Mode',
      'Default User Configuration',
      'Search Settings',
      'Update Notifications',
    ],
  ],
  ['routes/dashboard/admin/organizations/+page.svelte', ['View Details']],
  ['routes/dashboard/admin/projects/+page.svelte', ['View Details', 'API Keys']],
  ['routes/dashboard/admin/users/+page.svelte', ['View Details']],
  [
    'routes/dashboard/admin/projects/[id]/+page.svelte',
    ['API Keys', 'Delete Project'],
  ],
];

describe('sentence case in fixed UI strings (UI-8)', () => {
  for (const [file, phrases] of TITLE_CASE_LEFTOVERS) {
    it(`${file} has no Title Case leftovers`, () => {
      const text = readFileSync(path.join(SRC, file), 'utf8');
      const found = phrases.filter((p) => text.includes(p));
      expect(found).toEqual([]);
    });
  }
});
