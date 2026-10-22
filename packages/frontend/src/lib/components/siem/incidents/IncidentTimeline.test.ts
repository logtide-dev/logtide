import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { addComment } = vi.hoisted(() => ({ addComment: vi.fn() }));
vi.mock('$lib/api/incidents', () => ({ incidentsAPI: { addComment } }));

import IncidentTimeline from './IncidentTimeline.svelte';
import { buildMergedTimeline } from './incident-model';

const members = [{ id: 'm1', user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' } }] as never;

const detection = {
  id: 'd1',
  time: '2026-10-22T10:00:00.000Z',
  projectId: 'p1',
  logId: 'l1',
  severity: 'high',
  ruleTitle: 'SSH brute force',
  ruleDescription: null,
  service: 'auth',
  logLevel: 'error',
  logMessage: 'failed password for root',
  traceId: 'abc123',
  matchedFields: { user: 'root' },
};

function entries(over: Record<string, unknown> = {}) {
  return buildMergedTimeline({
    detections: [detection],
    comments: [
      { id: 'c1', userId: 'u1', comment: 'looking into it', createdAt: '2026-10-22T10:05:00.000Z' },
    ],
    history: [
      {
        id: 'h1',
        action: 'status_change',
        oldValue: 'open',
        newValue: 'investigating',
        createdAt: '2026-10-22T10:03:00.000Z',
        metadata: null,
        userName: 'Ada Lovelace',
      },
    ],
    sourceEvents: [],
    ...over,
  } as never);
}

function props(over: Record<string, unknown> = {}) {
  return {
    entries: entries(),
    members,
    organizationId: 'org1',
    incidentId: 'i1',
    onCommentAdded: vi.fn(),
    ...over,
  };
}

beforeEach(() => addComment.mockReset());

describe('IncidentTimeline', () => {
  it('merges detection, comment and history entries newest first', () => {
    render(IncidentTimeline, { props: props() });
    const text = screen.getByRole('list').textContent ?? '';
    const iComment = text.indexOf('looking into it');
    const iHistory = text.indexOf('Status changed from Open to Acknowledged');
    const iDetection = text.indexOf('SSH brute force');
    expect(iComment).toBeGreaterThanOrEqual(0);
    expect(iHistory).toBeGreaterThan(iComment);
    expect(iDetection).toBeGreaterThan(iHistory);
  });

  it('renders alert_trigger and monitor_check entries from sourceEvents', () => {
    render(IncidentTimeline, {
      props: props({
        entries: entries({
          detections: [],
          sourceEvents: [
            { id: 's1', kind: 'alert_trigger', time: '2026-10-22T09:00:00.000Z', summary: '42 logs in 5 minutes' },
            { id: 's2', kind: 'monitor_check', time: '2026-10-22T08:00:00.000Z', summary: 'HTTP 503' },
          ],
        }),
      }),
    });
    expect(screen.getByText('42 logs in 5 minutes')).toBeTruthy();
    expect(screen.getByText('HTTP 503')).toBeTruthy();
    expect(screen.getByText('Alert triggered')).toBeTruthy();
    expect(screen.getByText('Monitor check failed')).toBeTruthy();
  });

  it('trace id renders a link to /dashboard/traces/<id>?project=<pid>', async () => {
    render(IncidentTimeline, { props: props() });
    await fireEvent.click(screen.getByRole('button', { name: /Show details/ }));
    const link = screen.getByRole('link', { name: /Trace abc123/ }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/dashboard/traces/abc123?project=p1');
    expect((screen.getByRole('link', { name: 'Open log' }) as HTMLAnchorElement).getAttribute('href')).toBe(
      '/dashboard/logs?logId=l1&project=p1'
    );
  });

  it('posting a comment calls addComment and onCommentAdded', async () => {
    const created = { id: 'c2', userId: 'u1', comment: 'done', createdAt: '2026-10-22T11:00:00.000Z' };
    addComment.mockResolvedValue(created);
    const p = props();
    render(IncidentTimeline, { props: p });
    await fireEvent.input(screen.getByLabelText('Add a comment'), { target: { value: '  done  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(p.onCommentAdded).toHaveBeenCalledWith(created));
    expect(addComment).toHaveBeenCalledWith('i1', 'org1', 'done');
  });

  it('Add comment is disabled for an empty draft', () => {
    render(IncidentTimeline, { props: props() });
    expect((screen.getByRole('button', { name: 'Add comment' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('empty timeline shows a message', () => {
    render(IncidentTimeline, { props: props({ entries: [] }) });
    expect(screen.getByText(/Nothing has happened/)).toBeTruthy();
  });
});
