import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

const getCorrelatedLogs = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/correlation', () => ({ correlationAPI: { getCorrelatedLogs } }));

import CorrelationTimelineDialog from './CorrelationTimelineDialog.svelte';
import { displayPreferences } from '$lib/stores/display-preferences';
import { levelTone } from '$lib/utils/severity';
import type { CorrelatedLog, CorrelationResult } from '$lib/api/correlation';

const LOGS: CorrelatedLog[] = [
  {
    id: 'c1',
    time: '2026-10-21T10:40:00.250Z',
    service: 'api',
    level: 'info',
    message: 'request started',
    metadata: { user_id: 'u-1' },
    traceId: 'trace-abcdef123456',
    projectId: 'p1',
  },
  {
    id: 'c2',
    time: '2026-10-21T10:41:00.500Z',
    service: 'worker',
    level: 'error',
    message: 'job failed',
    metadata: null,
    traceId: null,
    projectId: 'p1',
  },
];

function result(minutes: number): CorrelationResult {
  const ref = new Date('2026-10-21T10:42:00.000Z').getTime();
  return {
    identifier: { type: 'user_id', value: 'u-1' },
    logs: LOGS,
    total: LOGS.length,
    timeWindow: {
      from: new Date(ref - minutes * 60_000).toISOString(),
      to: new Date(ref + minutes * 60_000).toISOString(),
    },
  };
}

function setup() {
  const onClose = vi.fn();
  const onLogClick = vi.fn();
  const utils = render(CorrelationTimelineDialog, {
    props: {
      open: true,
      projectId: 'p1',
      identifierType: 'user_id',
      identifierValue: 'u-1',
      referenceTime: '2026-10-21T10:42:00.000Z',
      onClose,
      onLogClick,
    },
  });
  return { ...utils, onClose, onLogClick };
}

beforeEach(() => {
  getCorrelatedLogs.mockReset();
  getCorrelatedLogs.mockImplementation((p: { timeWindowMinutes: number }) => Promise.resolve(result(p.timeWindowMinutes)));
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
});

describe('CorrelationTimelineDialog', () => {
  it('defaults to a 15 minute window', async () => {
    setup();
    await screen.findByText('job failed');
    expect(getCorrelatedLogs).toHaveBeenCalledTimes(1);
    expect(getCorrelatedLogs).toHaveBeenCalledWith({
      projectId: 'p1',
      identifierValue: 'u-1',
      referenceTime: '2026-10-21T10:42:00.000Z',
      timeWindowMinutes: 15,
      limit: 100,
    });
    expect(screen.getByRole('button', { name: '15m' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1h' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('dialog')).toHaveTextContent('Time window: Oct 21, 10:27 to 10:57');
  });

  it.each([
    ['1h', 60],
    ['6h', 360],
  ])('switching to %s refetches with %i minutes', async (label, minutes) => {
    setup();
    await screen.findByText('job failed');
    await fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(getCorrelatedLogs).toHaveBeenCalledTimes(2));
    expect(getCorrelatedLogs.mock.calls[1][0]).toMatchObject({ timeWindowMinutes: minutes });
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '15m' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('rows call onLogClick', async () => {
    const { onLogClick } = setup();
    await screen.findByText('job failed');
    await fireEvent.click(screen.getByRole('button', { name: /job failed/ }));
    expect(onLogClick).toHaveBeenCalledWith(LOGS[1]);
  });

  it('uses the shared level styling, millisecond times and sentence case', async () => {
    setup();
    await screen.findByText('job failed');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Correlated events' })).toBeInTheDocument();
    expect(within(dialog).getAllByTestId('severity-badge')).toHaveLength(2);
    expect(dialog).toHaveTextContent('Oct 21, 10:41:00.500');
    const errorRow = screen.getByRole('button', { name: /job failed/ });
    const dot = errorRow.querySelector('[data-testid="timeline-dot"]');
    expect(dot?.className).toContain(levelTone('error').dot);
    const infoRow = screen.getByRole('button', { name: /request started/ });
    expect(infoRow.querySelector('[data-testid="timeline-dot"]')?.className).toContain(levelTone('info').dot);
    // the trace chip carries no palette classes
    const chip = within(infoRow).getByText(/trace-ab/);
    expect(chip.className).not.toMatch(/(indigo|purple|blue)-\d/);
    expect(dialog).toHaveTextContent('Found 2 correlated events across services');
  });

  it('drops a stale response after a window switch', async () => {
    let resolveFirst!: (r: CorrelationResult) => void;
    getCorrelatedLogs.mockReset();
    getCorrelatedLogs
      .mockImplementationOnce(() => Promise.resolve(result(15)))
      .mockImplementationOnce(() => new Promise<CorrelationResult>((r) => (resolveFirst = r)))
      .mockImplementationOnce(() =>
        Promise.resolve({ ...result(360), logs: [{ ...LOGS[0], id: 'c9', message: 'six hours' }], total: 1 }),
      );
    setup();
    await screen.findByText('job failed');
    await fireEvent.click(screen.getByRole('button', { name: '1h' }));
    await fireEvent.click(screen.getByRole('button', { name: '6h' }));
    await screen.findByText('six hours');
    resolveFirst({ ...result(60), logs: [{ ...LOGS[0], id: 'c8', message: 'one hour' }], total: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('one hour')).toBeNull();
    expect(screen.getByText('six hours')).toBeInTheDocument();
  });
});
