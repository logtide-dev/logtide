import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { ErrorGroupEvent } from '@logtide/shared';
import LatestEventPanel from './LatestEventPanel.svelte';
import { buildLogsWindowHref, buildSessionHref, buildTraceHref } from './error-group-links';

function event(over: Partial<ErrorGroupEvent> = {}): ErrorGroupEvent {
  return {
    cursor: 'ex1',
    exception: {
      id: 'ex1',
      organizationId: 'org1',
      projectId: 'p1',
      logId: 'log1',
      exceptionType: 'TypeError',
      exceptionMessage: 'x is undefined',
      language: 'nodejs',
      fingerprint: 'fp',
      rawStackTrace: 'TypeError: x is undefined\n    at doThing (/app/src/a.ts:10:5)',
      frameCount: 1,
      createdAt: '2026-10-20T10:00:00.000Z',
    },
    frames: [
      {
        id: 'f1',
        exceptionId: 'ex1',
        frameIndex: 0,
        filePath: '/app/src/a.ts',
        functionName: 'doThing',
        lineNumber: 10,
        columnNumber: 5,
        isAppCode: true,
        codeContext: null,
        metadata: null,
      },
    ] as any,
    log: {
      id: 'log1',
      time: '2026-10-20T10:00:00.000Z',
      service: 'api',
      message: 'boom',
      level: 'error',
      traceId: 'trace-1',
      spanId: 'span-1',
      sessionId: 'sess-1',
      hostname: null,
      metadata: null,
    },
    ...over,
  };
}

function setup(over: Record<string, unknown> = {}) {
  const handlers = { onOlder: vi.fn(), onNewer: vi.fn() };
  render(LatestEventPanel, {
    event: event(),
    loading: false,
    hasOlder: true,
    hasNewer: false,
    projectId: 'p1',
    ...handlers,
    ...over,
  });
  return handlers;
}

describe('LatestEventPanel', () => {
  it('renders stack frames from the event', () => {
    setup();
    expect(screen.getByText(/doThing/)).toBeInTheDocument();
  });

  it('Older and Newer buttons reflect hasOlder and hasNewer and call their handlers', async () => {
    const h = setup({ hasOlder: true, hasNewer: false });
    expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Older' }));
    expect(h.onOlder).toHaveBeenCalledTimes(1);
  });

  it('Newer is enabled when there are newer events', async () => {
    const h = setup({ hasOlder: false, hasNewer: true });
    expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Newer' }));
    expect(h.onNewer).toHaveBeenCalledTimes(1);
  });

  it('shows the Latest event chip only without newer events', () => {
    const { unmount } = render(LatestEventPanel, {
      event: event(),
      loading: false,
      hasOlder: true,
      hasNewer: false,
      projectId: 'p1',
      onOlder: vi.fn(),
      onNewer: vi.fn(),
    });
    expect(screen.getByText('Latest event')).toBeInTheDocument();
    unmount();
    render(LatestEventPanel, {
      event: event(),
      loading: false,
      hasOlder: true,
      hasNewer: true,
      projectId: 'p1',
      onOlder: vi.fn(),
      onNewer: vi.fn(),
    });
    expect(screen.queryByText('Latest event')).not.toBeInTheDocument();
    expect(screen.getByText(/Event from/)).toBeInTheDocument();
  });

  it('trace, logs window and session links have the exact hrefs', () => {
    setup();
    expect(screen.getByRole('link', { name: 'View trace' })).toHaveAttribute(
      'href',
      buildTraceHref('trace-1', 'p1')
    );
    expect(screen.getByRole('link', { name: 'View logs around this event' })).toHaveAttribute(
      'href',
      buildLogsWindowHref({ projectId: 'p1', time: '2026-10-20T10:00:00.000Z', logId: 'log1' })
    );
    expect(screen.getByRole('link', { name: 'View session' })).toHaveAttribute(
      'href',
      buildSessionHref('sess-1', 'p1')
    );
  });

  it('omits trace and session links when absent', () => {
    const e = event();
    e.log = { ...e.log!, traceId: null, sessionId: null };
    setup({ event: e });
    expect(screen.queryByRole('link', { name: 'View trace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View session' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View logs around this event' })).toBeInTheDocument();
  });

  it('log null shows the retention note and hides log links', () => {
    setup({ event: event({ log: null }) });
    expect(screen.getByText('The log entry for this event is no longer available')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View trace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View logs around this event' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View session' })).not.toBeInTheDocument();
    // stack still renders from the exceptions table
    expect(screen.getByText(/doThing/)).toBeInTheDocument();
  });

  it('breadcrumbs render only when metadata has them', () => {
    const e = event();
    setup({ event: e });
    expect(screen.queryByText('Breadcrumbs')).not.toBeInTheDocument();
  });

  it('breadcrumbs render when metadata carries a non-empty array', () => {
    const e = event();
    e.log = {
      ...e.log!,
      metadata: {
        breadcrumbs: [
          { type: 'navigation', message: 'Opened checkout', timestamp: Date.parse('2026-10-20T09:59:50.000Z') },
        ],
      },
    };
    setup({ event: e });
    expect(screen.getByText(/Opened checkout/)).toBeInTheDocument();
  });

  it('the description says stack trace from the event shown, never most recent occurrence', () => {
    setup({ hasNewer: true });
    expect(screen.getByText('Stack trace from the event shown')).toBeInTheDocument();
    expect(screen.queryByText(/most recent occurrence/i)).not.toBeInTheDocument();
  });

  it('shows an empty state when there is no event', () => {
    setup({ event: null, hasOlder: false });
    expect(screen.getByText(/No stack trace available/)).toBeInTheDocument();
  });
});
