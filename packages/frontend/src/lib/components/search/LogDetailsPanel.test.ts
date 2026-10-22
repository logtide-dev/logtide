import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import LogDetailsPanel from './LogDetailsPanel.svelte';
import { makeLog, resetLogIds } from './test-fixtures';
import { displayPreferences } from '$lib/stores/display-preferences';
import type { LogEntry } from '$lib/api/logs';
import type { IdentifierMatch } from '$lib/api/correlation';

vi.mock('$lib/components/app/KeyValueTable.svelte', async () => ({
  default: (await import('./test-stubs/KeyValueTableStub.svelte')).default,
}));

vi.mock('$lib/api/exceptions', () => ({
  getExceptionByLogId: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  resetLogIds();
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
});

function fullLog(overrides: Partial<LogEntry> = {}): LogEntry {
  return makeLog({
    level: 'error',
    service: 'api',
    hostname: 'web-1',
    traceId: 't1',
    sessionId: 's1',
    spanId: 'sp1',
    message: 'first line\nsecond line',
    metadata: {
      user: { id: 42 },
      breadcrumbs: [
        { type: 'http', message: 'GET /a', timestamp: Date.parse('2026-10-21T10:42:12Z') },
        { type: 'ui', message: 'click', timestamp: Date.parse('2026-10-21T10:42:13Z') },
      ],
    },
    ...overrides,
  });
}

function setup(log: LogEntry | null = fullLog(), identifiers: IdentifierMatch[] = []) {
  const handlers = {
    onClose: vi.fn(),
    onFilter: vi.fn(),
    onProjectFilter: vi.fn(),
    onAddColumn: vi.fn(),
    onOpenContext: vi.fn(),
    onOpenCorrelation: vi.fn(),
  };
  const utils = render(LogDetailsPanel, {
    props: { log, projectName: 'Shop', identifiers, organizationId: 'org1', ...handlers },
  });
  return { ...utils, ...handlers };
}

describe('LogDetailsPanel', () => {
  it('shows the level, the millisecond timestamp and the full message', () => {
    const utils = setup();
    const panel = utils.getByRole('complementary', { name: 'Log details' });
    expect(within(panel).getAllByTestId('severity-badge')[0]).toHaveTextContent('Error');
    expect(panel).toHaveTextContent('10:42:13.123');
    expect(panel).toHaveTextContent('UTC');
    const pre = panel.querySelector('pre');
    expect(pre?.textContent).toBe('first line\nsecond line');
    expect(pre?.className).toContain('whitespace-pre-wrap');
  });

  it('metadata Filter and Exclude call onFilter with the path and the string value', async () => {
    const utils = setup();
    await fireEvent.click(utils.getByRole('button', { name: 'stub filter' }));
    expect(utils.onFilter).toHaveBeenLastCalledWith('user.id', '42', false);
    await fireEvent.click(utils.getByRole('button', { name: 'stub exclude' }));
    expect(utils.onFilter).toHaveBeenLastCalledWith('user.id', '42', true);
  });

  it('ignores Filter on null values', async () => {
    const utils = setup();
    await fireEvent.click(utils.getByRole('button', { name: 'stub filter null' }));
    expect(utils.onFilter).not.toHaveBeenCalled();
  });

  it('Add as column calls onAddColumn', async () => {
    const utils = setup();
    await fireEvent.click(utils.getByRole('button', { name: 'stub add column' }));
    expect(utils.onAddColumn).toHaveBeenCalledWith('user.id');
  });

  it('passes metadata without breadcrumbs to the tree', () => {
    const utils = setup();
    expect(utils.getByTestId('kv-stub')).toHaveAttribute('data-keys', 'user');
  });

  it('built-in chips offer Filter and Exclude', async () => {
    const utils = setup();
    await fireEvent.click(utils.getByRole('button', { name: 'Exclude service api' }));
    expect(utils.onFilter).toHaveBeenLastCalledWith('service', 'api', true);
    await fireEvent.click(utils.getByRole('button', { name: 'Filter by host web-1' }));
    expect(utils.onFilter).toHaveBeenLastCalledWith('host', 'web-1', false);
    await fireEvent.click(utils.getByRole('button', { name: 'Filter by level error' }));
    expect(utils.onFilter).toHaveBeenLastCalledWith('level', 'error', false);
    await fireEvent.click(utils.getByRole('button', { name: 'Exclude level error' }));
    expect(utils.onFilter).toHaveBeenLastCalledWith('level', 'error', true);
  });

  it('trace, session and span chips filter by equality only', async () => {
    const utils = setup();
    await fireEvent.click(utils.getByRole('button', { name: 'Filter by session s1' }));
    expect(utils.onFilter).toHaveBeenLastCalledWith('session', 's1', false);
    await fireEvent.click(utils.getByRole('button', { name: 'Filter by span sp1' }));
    expect(utils.onFilter).toHaveBeenLastCalledWith('span', 'sp1', false);
    expect(utils.queryByRole('button', { name: /^Exclude (trace|session|span) / })).toBeNull();
  });

  it('reads the host from metadata when the payload has none', () => {
    const utils = setup(makeLog({ hostname: null, metadata: { hostname: 'db-2' } }));
    expect(utils.getByRole('button', { name: 'Filter by host db-2' })).toBeInTheDocument();
    utils.unmount();
    const none = setup(makeLog({ hostname: null, metadata: { hostname: 7 } }));
    expect(none.queryByRole('button', { name: /Filter by host/ })).toBeNull();
  });

  it('the project chip filters instead of navigating', async () => {
    const utils = setup();
    expect(utils.container.querySelector('a[href^="/dashboard/projects"]')).toBeNull();
    await fireEvent.click(utils.getByRole('button', { name: 'Filter by project Shop' }));
    expect(utils.onProjectFilter).toHaveBeenCalledWith('p1');
  });

  it('links the trace and offers filter by this trace', async () => {
    const utils = setup();
    expect(utils.getByRole('link', { name: 'Open trace' })).toHaveAttribute('href', '/dashboard/traces/t1?projectId=p1');
    await fireEvent.click(utils.getByRole('button', { name: 'Filter by trace t1' }));
    expect(utils.onFilter).toHaveBeenLastCalledWith('trace', 't1', false);
  });

  it('links the session page', () => {
    const utils = setup();
    expect(utils.getByRole('link', { name: 'Open session' })).toHaveAttribute('href', '/dashboard/sessions/s1?project=p1');
  });

  it('encodes ids in links', () => {
    const utils = setup(fullLog({ sessionId: 'a/b c', traceId: 'x?y' }));
    expect(utils.getByRole('link', { name: 'Open session' })).toHaveAttribute(
      'href',
      '/dashboard/sessions/a%2Fb%20c?project=p1',
    );
    expect(utils.getByRole('link', { name: 'Open trace' })).toHaveAttribute('href', '/dashboard/traces/x%3Fy?projectId=p1');
  });

  it('renders without metadata', () => {
    const utils = setup(makeLog({ metadata: null }));
    expect(utils.getByText('No metadata')).toBeInTheDocument();
    expect(utils.queryByRole('button', { name: 'stub filter' })).toBeNull();
    expect(utils.queryByRole('button', { name: /Breadcrumbs/ })).toBeNull();
  });

  it('renders nothing without a log', () => {
    const utils = setup(null);
    expect(utils.queryByRole('complementary')).toBeNull();
  });

  it('closes on Escape and from the close button', async () => {
    const utils = setup();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(utils.onClose).toHaveBeenCalledTimes(1);
    await fireEvent.click(utils.getByRole('button', { name: 'Close log details' }));
    expect(utils.onClose).toHaveBeenCalledTimes(2);
  });

  it('ignores Escape typed in an input', async () => {
    const utils = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(utils.onClose).not.toHaveBeenCalled();
    input.remove();
  });

  it('offers Copy link and Copy JSON', () => {
    const utils = setup();
    expect(utils.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
    expect(utils.getByRole('button', { name: /copy json/i })).toBeInTheDocument();
  });

  it('opens the context and the correlation', async () => {
    const log = fullLog();
    const utils = setup(log, [{ type: 'request_id', value: 'req-9', sourceField: 'metadata.requestId' }]);
    await fireEvent.click(utils.getByRole('button', { name: 'View context' }));
    expect(utils.onOpenContext).toHaveBeenCalledWith(log);
    await fireEvent.click(utils.getByRole('button', { name: 'Show events with Request ID req-9' }));
    expect(utils.onOpenCorrelation).toHaveBeenCalledWith(log, 'request_id', 'req-9');
    expect(utils.getByRole('link', { name: 'Configure' })).toHaveAttribute('href', '/dashboard/settings/patterns');
  });

  it('offers exception details for error and critical logs only', () => {
    const utils = setup();
    expect(utils.getByRole('button', { name: 'View exception details' })).toBeInTheDocument();
    utils.unmount();
    const info = setup(makeLog({ level: 'info' }));
    expect(info.queryByRole('button', { name: 'View exception details' })).toBeNull();
  });

  it('expands the breadcrumbs', async () => {
    const utils = setup();
    const toggle = utils.getByRole('button', { name: 'Breadcrumbs (2)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(toggle);
    await tick();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(utils.getByText('GET /a')).toBeInTheDocument();
  });
});
