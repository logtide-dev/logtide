import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';

const getLogContext = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/logs', () => ({ logsAPI: { getLogContext } }));

import LogContextDialog from './LogContextDialog.svelte';
import { displayPreferences } from '$lib/stores/display-preferences';
import { makeLog, deferred } from './search/test-fixtures';
import type { LogContextResponse, LogEntry } from '$lib/api/logs';

const SELECTED = makeLog({
  id: 'log-1',
  projectId: 'p1',
  time: '2026-10-21T10:42:13.123Z',
  service: 'api',
  level: 'error',
  message: 'Selected failure',
  metadata: { hostname: 'web-1', user: { id: 42 } },
});

function rows(prefix: string, n: number, overrides: Partial<LogEntry> = {}): LogEntry[] {
  return Array.from({ length: n }, (_, i) =>
    makeLog({ id: `${prefix}-${i}`, message: `${prefix} ${i}`, ...overrides }),
  );
}

function ctx(
  before: number,
  after: number,
  applied: LogContextResponse['applied'] = { service: null, hostname: null },
  prefix = '',
): LogContextResponse {
  return {
    before: rows(`${prefix}before`, before),
    current: SELECTED,
    after: rows(`${prefix}after`, after),
    applied,
  };
}

/** Answers every request with as many rows as it asked for. */
function echo(applied?: LogContextResponse['applied']) {
  getLogContext.mockImplementation((p: { before: number; after: number; sameService?: boolean; sameHost?: boolean }) =>
    Promise.resolve(
      ctx(p.before, p.after, applied ?? { service: p.sameService ? 'api' : null, hostname: p.sameHost ? 'web-1' : null }),
    ),
  );
}

function setup(props: Partial<{ selectedLog: LogEntry | null; organizationId: string; onOpenAround: (log: LogEntry) => void }> = {}) {
  const onClose = vi.fn();
  const onOpenAround = props.onOpenAround ?? vi.fn();
  const utils = render(LogContextDialog, {
    props: {
      open: true,
      projectId: 'p1',
      organizationId: props.organizationId ?? 'org-1',
      selectedLog: props.selectedLog === undefined ? SELECTED : props.selectedLog,
      onClose,
      onOpenAround,
    },
  });
  return { ...utils, onClose, onOpenAround };
}

const lastCall = () => getLogContext.mock.calls[getLogContext.mock.calls.length - 1][0];

beforeEach(() => {
  getLogContext.mockReset();
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
});

describe('LogContextDialog', () => {
  it('loads 25 before and after', async () => {
    echo();
    setup();
    await screen.findByText('before 0');
    expect(getLogContext).toHaveBeenCalledTimes(1);
    expect(getLogContext).toHaveBeenCalledWith({
      projectId: 'p1',
      time: '2026-10-21T10:42:13.123Z',
      logId: 'log-1',
      before: 25,
      after: 25,
      sameService: false,
      sameHost: false,
    });
    expect(screen.getByText('25 logs before')).toBeInTheDocument();
    expect(screen.getByText('25 logs after')).toBeInTheDocument();
  });

  it('uses the sentence case copy and the display zone', async () => {
    echo();
    setup();
    await screen.findByText('before 0');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Log context' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Logs before and after the selected entry');
    expect(dialog).toHaveTextContent('Times in UTC');
    expect(within(dialog).getByText('Selected log')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Oct 21, 10:42:13.123');
    expect(within(dialog).getByRole('button', { name: 'View exception details' })).toBeInTheDocument();
  });

  it('Load 25 earlier grows the before side up to 100', async () => {
    echo();
    setup();
    await screen.findByText('before 0');
    for (const expected of [50, 75, 100]) {
      await fireEvent.click(screen.getByRole('button', { name: 'Load 25 earlier' }));
      await waitFor(() => expect(lastCall().before).toBe(expected));
      expect(lastCall().after).toBe(25);
      expect(lastCall().logId).toBe('log-1');
      await screen.findByText(`${expected} logs before`);
    }
    expect(screen.queryByRole('button', { name: 'Load 25 earlier' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Load 25 later' })).toBeInTheDocument();
  });

  it('Load 25 later grows the after side', async () => {
    echo();
    setup();
    await screen.findByText('after 0');
    await fireEvent.click(screen.getByRole('button', { name: 'Load 25 later' }));
    await waitFor(() => expect(lastCall()).toMatchObject({ before: 25, after: 50 }));
    await screen.findByText('50 logs after');
  });

  it('hides Load 25 earlier when fewer rows came back', async () => {
    getLogContext.mockResolvedValue(ctx(10, 25));
    setup();
    await screen.findByText('before 0');
    expect(screen.queryByRole('button', { name: 'Load 25 earlier' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Load 25 later' })).toBeInTheDocument();
  });

  it('Same service refetches with sameService and the reference logId', async () => {
    echo();
    setup();
    await screen.findByText('before 0');
    const toggle = screen.getByRole('switch', { name: 'Same service' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await fireEvent.click(toggle);
    await waitFor(() => expect(getLogContext).toHaveBeenCalledTimes(2));
    const call = lastCall();
    expect(call).toMatchObject({ projectId: 'p1', logId: 'log-1', sameService: true, sameHost: false, before: 25, after: 25 });
    expect(call).not.toHaveProperty('service');
    expect(call).not.toHaveProperty('hostname');
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Same service' })).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByRole('dialog')).toHaveTextContent('Service: api');
  });

  it('the switch follows applied.service of the response', async () => {
    getLogContext.mockResolvedValue(ctx(5, 5, { service: null, hostname: null }));
    setup();
    await screen.findByText('before 0');
    await fireEvent.click(screen.getByRole('switch', { name: 'Same service' }));
    await waitFor(() => expect(getLogContext).toHaveBeenCalledTimes(2));
    await tick();
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Same service' })).toHaveAttribute('aria-checked', 'false'),
    );
  });

  it('keeps the requested size when toggling', async () => {
    echo();
    setup();
    await screen.findByText('before 0');
    await fireEvent.click(screen.getByRole('button', { name: 'Load 25 earlier' }));
    await screen.findByText('50 logs before');
    await fireEvent.click(screen.getByRole('switch', { name: 'Same host' }));
    await waitFor(() => expect(lastCall()).toMatchObject({ before: 50, after: 25, sameHost: true, sameService: false }));
  });

  it('Same host is disabled without a host', async () => {
    echo();
    setup({ selectedLog: makeLog({ id: 'log-9', metadata: { hostname: 42 }, hostname: null }) });
    await screen.findByText('before 0');
    expect(screen.getByRole('switch', { name: 'Same host' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Same service' })).toBeEnabled();
  });

  it('Same host is enabled with a top-level host', async () => {
    echo();
    setup({ selectedLog: makeLog({ id: 'log-9', metadata: null, hostname: 'db-1' }) });
    await screen.findByText('before 0');
    expect(screen.getByRole('switch', { name: 'Same host' })).toBeEnabled();
  });

  it('clicking a row opens the explorer around it', async () => {
    const response = ctx(2, 2);
    getLogContext.mockResolvedValue(response);
    const { onOpenAround } = setup();
    await screen.findByText('before 0');
    await fireEvent.click(screen.getByRole('button', { name: /after 1$/ }));
    expect(onOpenAround).toHaveBeenCalledWith(response.after[1]);
  });

  it('links trace ids', async () => {
    const response = ctx(1, 0);
    response.before[0] = { ...response.before[0], traceId: 't1', projectId: 'p1' };
    getLogContext.mockResolvedValue(response);
    const { onOpenAround } = setup();
    await screen.findByText('before 0');
    const link = screen.getByRole('link', { name: /t1/ });
    expect(link).toHaveAttribute('href', '/dashboard/traces/t1?projectId=p1');
    link.addEventListener('click', (e) => e.preventDefault());
    await fireEvent.click(link);
    expect(onOpenAround).not.toHaveBeenCalled();
  });

  it('drops a stale response', async () => {
    echo();
    setup();
    await screen.findByText('before 0');
    const first = deferred<LogContextResponse>();
    const second = deferred<LogContextResponse>();
    getLogContext.mockReset();
    getLogContext.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await fireEvent.click(screen.getByRole('switch', { name: 'Same service' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Same service' }));
    expect(getLogContext).toHaveBeenCalledTimes(2);
    expect(getLogContext.mock.calls[1][0]).toMatchObject({ sameService: false });
    second.resolve(ctx(1, 1, { service: null, hostname: null }, 'second-'));
    await screen.findByText('second-before 0');
    first.resolve(ctx(1, 1, { service: 'api', hostname: null }, 'first-'));
    await tick();
    await tick();
    expect(screen.queryByText('first-before 0')).toBeNull();
    expect(screen.getByText('second-before 0')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Same service' })).toHaveAttribute('aria-checked', 'false');
  });

  it('shows metadata in a collapsed table', async () => {
    echo();
    setup();
    await screen.findByText('before 0');
    const dialog = screen.getByRole('dialog');
    const summaries = within(dialog).getAllByText('View metadata');
    expect(summaries.length).toBeGreaterThan(0);
    const selectedDetails = within(dialog).getByTestId('selected-metadata');
    // collapsed: the table is not rendered yet
    expect(within(selectedDetails).queryByText('hostname')).toBeNull();
    (selectedDetails as HTMLDetailsElement).open = true;
    selectedDetails.dispatchEvent(new Event('toggle'));
    await tick();
    expect(within(selectedDetails).getByText('hostname')).toBeInTheDocument();
    // KeyValueTable's copy buttons replace the old icon-only copy button, and it offers no filter actions
    expect(within(selectedDetails).getAllByRole('button', { name: 'Copy value' }).length).toBeGreaterThan(0);
    expect(within(selectedDetails).queryByRole('button', { name: /^Filter/ })).toBeNull();
    expect(within(dialog).queryByTitle('Copy metadata')).toBeNull();
  });

  it('shows the error message', async () => {
    getLogContext.mockRejectedValue(new Error('Failed to fetch log context'));
    setup();
    expect(await screen.findByText('Failed to fetch log context')).toBeInTheDocument();
  });

  it('shows an empty context', async () => {
    getLogContext.mockResolvedValue(ctx(0, 0));
    setup();
    expect(await screen.findByText('No logs found before or after this entry')).toBeInTheDocument();
  });

  it('hides exception details for non-error levels', async () => {
    echo();
    setup({ selectedLog: makeLog({ id: 'log-7', level: 'info' }) });
    await screen.findByText('before 0');
    expect(screen.queryByRole('button', { name: 'View exception details' })).toBeNull();
  });

  it('restarts from 25 for another log', async () => {
    echo();
    const utils = setup();
    await screen.findByText('before 0');
    await fireEvent.click(screen.getByRole('button', { name: 'Load 25 earlier' }));
    await screen.findByText('50 logs before');
    await fireEvent.click(screen.getByRole('switch', { name: 'Same service' }));
    await waitFor(() => expect(lastCall().sameService).toBe(true));
    await utils.rerender({ selectedLog: makeLog({ id: 'log-8', message: 'other' }) });
    await waitFor(() => expect(lastCall()).toMatchObject({ logId: 'log-8', before: 25, after: 25, sameService: false }));
  });
});
