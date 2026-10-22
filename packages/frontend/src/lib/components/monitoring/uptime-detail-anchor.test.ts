import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The incident source panel links to /dashboard/uptime/<id>#response-time, so
// the detail page must carry exactly one element with that id, wrapping the chart.
const page = readFileSync(
  path.resolve(__dirname, '../../../routes/dashboard/uptime/[id]/+page.svelte'),
  'utf8',
);

describe('uptime detail response time anchor', () => {
  it('has a single element with id response-time that contains the chart', () => {
    const matches = page.match(/id="response-time"/g) ?? [];
    expect(matches).toHaveLength(1);
    const start = page.indexOf('id="response-time"');
    const chart = page.indexOf('<ResponseTimeChart');
    expect(chart).toBeGreaterThan(start);
    expect(chart - start).toBeLessThan(200);
  });
});
