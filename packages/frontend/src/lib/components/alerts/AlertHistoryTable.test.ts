import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/svelte';
import AlertHistoryTable from './AlertHistoryTable.svelte';
import type { AlertHistory, AlertRule } from '$lib/api/alerts';
import { parseLogQuery, type DetectionEvent } from '@logtide/shared';

function hist(over: Partial<AlertHistory> = {}): AlertHistory {
  return {
    id: 'h1',
    ruleId: 'r1',
    ruleName: 'High errors',
    projectId: 'p1',
    projectName: 'Web',
    triggeredAt: '2026-10-20T10:00:00.000Z',
    logCount: 14,
    notified: true,
    error: null,
    threshold: 10,
    timeWindow: 5,
    service: null,
    level: ['error'],
    alertType: 'threshold',
    baselineMetadata: null,
    ...over,
  };
}

function rule(over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'r1',
    organizationId: 'org-1',
    projectId: 'p1',
    name: 'High errors',
    enabled: true,
    service: 'api',
    level: ['error', 'critical'],
    threshold: 10,
    timeWindow: 5,
    alertType: 'threshold',
    baselineType: null,
    deviationMultiplier: null,
    minBaselineValue: null,
    cooldownMinutes: null,
    sustainedMinutes: null,
    emailRecipients: [],
    webhookUrl: null,
    metadataFilters: [{ key: 'env', op: 'equals', value: 'prod', include_missing: false } as never],
    query: 'timeout',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function det(over: Partial<DetectionEvent> = {}): DetectionEvent {
  return {
    id: 'd1',
    time: '2026-10-20T11:00:00.000Z',
    organizationId: 'org-1',
    projectId: 'p1',
    sigmaRuleId: 'sr1',
    logId: 'log-1',
    severity: 'high',
    ruleTitle: 'Slow queries',
    ruleDescription: null,
    mitreTactics: null,
    mitreTechniques: null,
    service: 'db',
    logLevel: 'warn',
    logMessage: 'slow',
    traceId: 'abcdef1234567890',
    matchedFields: null,
    incidentId: null,
    category: 'database',
    ...over,
  } as DetectionEvent;
}

function mount(props: Record<string, unknown> = {}) {
  const onLoadMore = vi.fn();
  render(AlertHistoryTable, {
    props: {
      alerts: [],
      detections: [],
      rules: [],
      projectNames: { p1: 'Web' },
      loading: false,
      hasMore: false,
      onLoadMore,
      ...props,
    },
  });
  return { onLoadMore };
}

const hrefs = () => screen.queryAllByRole('link').map((a) => a.getAttribute('href') ?? '');

afterEach(() => cleanup());

describe('AlertHistoryTable', () => {
  it('Pending uses the neutral tone and not the failed tone', () => {
    mount({ alerts: [hist({ notified: false, error: null })] });
    const pending = screen.getByTestId('result-pending');
    expect(pending.textContent).toContain('Pending');
    expect(pending.className).toContain('bg-secondary');
    expect(pending.className).not.toContain('destructive');
  });

  it('Failed shows the error text', async () => {
    mount({ alerts: [hist({ notified: false, error: 'SMTP refused' })] });
    expect(screen.getByTestId('result-failed').className).toContain('destructive');
    await fireEvent.click(screen.getByRole('button', { name: 'Show error' }));
    expect(screen.getByText('SMTP refused')).toBeTruthy();
  });

  it('Show matched logs link carries project, q with level, service and metadata clauses, and from/to window', () => {
    mount({ alerts: [hist()], rules: [rule()] });
    const href = hrefs().find((h) => h.startsWith('/dashboard/logs'))!;
    const url = new URL(href, 'http://x');
    expect(url.searchParams.get('project')).toBe('p1');
    const q = url.searchParams.get('q')!;
    expect(q).toContain('timeout');
    expect(q).toContain('level:(error OR critical)');
    expect(q).toContain('service:api');
    expect(q).toContain('env:prod');
    const from = new Date(url.searchParams.get('from')!).getTime();
    const to = new Date(url.searchParams.get('to')!).getTime();
    expect(to).toBe(new Date('2026-10-20T10:00:00.000Z').getTime());
    expect(to - from).toBe(5 * 60_000);
  });

  it('deleted rule falls back to history fields and hides View rule', () => {
    mount({ alerts: [hist({ ruleId: 'gone', service: 'worker', level: ['warn'] })], rules: [] });
    const all = hrefs();
    expect(all.some((h) => h.startsWith('/dashboard/alerts?edit='))).toBe(false);
    const url = new URL(all.find((h) => h.startsWith('/dashboard/logs'))!, 'http://x');
    const q = url.searchParams.get('q')!;
    expect(q).toContain('level:warn');
    expect(q).toContain('service:worker');
  });

  it('existing rule shows View rule to edit', () => {
    mount({ alerts: [hist()], rules: [rule()] });
    expect(hrefs()).toContain('/dashboard/alerts?edit=r1');
  });

  it('org-wide alert has no project param', () => {
    mount({ alerts: [hist({ projectId: null, projectName: null, ruleId: 'x' })] });
    const href = hrefs().find((h) => h.startsWith('/dashboard/logs'))!;
    expect(new URL(href, 'http://x').searchParams.has('project')).toBe(false);
    expect(screen.getByText('All projects')).toBeTruthy();
  });

  it('detection row links to log, rule and trace', () => {
    mount({ detections: [det()] });
    const all = hrefs();
    expect(all).toContain('/dashboard/logs?logId=log-1&project=p1');
    expect(all).toContain('/dashboard/security/rules/sr1');
    expect(all).toContain('/dashboard/traces/abcdef1234567890?project=p1');
    expect(screen.getByText('Database')).toBeTruthy();
  });

  it('rows merge alerts and detections newest first', () => {
    mount({
      alerts: [hist({ id: 'h-old', ruleName: 'Old alert', triggeredAt: '2026-10-19T10:00:00.000Z' })],
      detections: [det({ time: '2026-10-20T11:00:00.000Z' })],
    });
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Slow queries')).toBeTruthy();
    expect(within(rows[1]).getByText('Old alert')).toBeTruthy();
  });

  it('timestamps show a zone label', () => {
    mount({ alerts: [hist()] });
    const time = document.querySelector('time')!;
    expect(time.textContent).toMatch(/[A-Z]{2,5}|GMT|UTC|[+-]\d/);
    expect(time.textContent!.length).toBeGreaterThan(19);
  });

  it('anomaly alerts are labelled Anomaly', () => {
    mount({ alerts: [hist({ alertType: 'rate_of_change' })] });
    expect(screen.getByText('Anomaly')).toBeTruthy();
  });

  it('Load more calls onLoadMore', async () => {
    const { onLoadMore } = mount({ alerts: [hist()], hasMore: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('service value with special characters is encoded in the link', () => {
    mount({ alerts: [hist({ ruleId: 'x', service: 'api & core (v2)' })] });
    const href = hrefs().find((h) => h.startsWith('/dashboard/logs'))!;
    const params = new URL(href, 'http://x').searchParams;
    expect(href).not.toContain('& core');
    const q = params.get('q')!;
    expect(q).toContain('service:"api & core (v2)"');
    expect(parseLogQuery(q).ok).toBe(true);
  });
});
