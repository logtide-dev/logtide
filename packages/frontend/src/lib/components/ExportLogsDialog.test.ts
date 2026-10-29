import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

const getLogs = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/logs', () => ({ logsAPI: { getLogs } }));

import ExportLogsDialog from './ExportLogsDialog.svelte';
import { toastStore } from '$lib/stores/toast';
import { displayPreferences } from '$lib/stores/display-preferences';
import { makeLog } from './search/test-fixtures';
import type { LogEntry } from '$lib/api/logs';

const PROJECTS = [
  { id: 'p1', name: 'Shop' },
  { id: 'p2', name: 'Billing' },
  { id: 'p3', name: 'Auth' },
  { id: 'p4', name: 'Search' },
];

const SCOPE = {
  q: 'level:error -service:api timeout',
  projectIds: ['p1', 'p2'],
  from: '2026-10-21T09:42:00.000Z',
  to: '2026-10-21T10:42:00.000Z',
};

let blobs: Blob[] = [];
let successSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

function setup(
  props: Partial<{
    totalLogs: number;
    scope: typeof SCOPE;
    customColumns: string[];
    projects: { id: string; name: string }[];
  }> = {},
) {
  return render(ExportLogsDialog, {
    props: {
      open: true,
      totalLogs: props.totalLogs ?? 2,
      scope: props.scope ?? SCOPE,
      projects: props.projects ?? PROJECTS,
      customColumns: props.customColumns ?? [],
    },
  });
}

function page(logs: LogEntry[], nextCursor?: string) {
  return { logs, total: 2, hasMore: !!nextCursor, limit: 1000, offset: 0, ...(nextCursor ? { nextCursor } : {}) };
}

async function chooseCsv() {
  await fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
}

async function exportNow() {
  const dialog = screen.getByRole('dialog');
  await fireEvent.click(within(dialog).getByRole('button', { name: /^Export [\d,]+ logs?$/ }));
}

async function exportedText(): Promise<string> {
  await waitFor(() => expect(blobs).toHaveLength(1));
  return blobs[0].text();
}

/** Splits RFC 4180 text into rows of fields (quoted fields may hold commas, quotes and newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

beforeEach(() => {
  blobs = [];
  getLogs.mockReset();
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b);
    return 'blob:export';
  });
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  successSpy = vi.spyOn(toastStore, 'success').mockImplementation(() => {});
  errorSpy = vi.spyOn(toastStore, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ExportLogsDialog', () => {
  it('lists every active clause and the projects', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Export logs' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Export logs matching the current query and scope');
    expect(dialog).toHaveTextContent('Active filters');
    expect(dialog).toHaveTextContent('Export format');
    expect(within(dialog).getByText('Level is error')).toBeInTheDocument();
    expect(within(dialog).getByText('Service is not api')).toBeInTheDocument();
    expect(within(dialog).getByText('Message contains the word "timeout"')).toBeInTheDocument();
    expect(within(dialog).getByText('Shop, Billing')).toBeInTheDocument();
    expect(within(dialog).getByText('Oct 21, 09:42 to 10:42')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('2 logs');
    expect(within(dialog).getByRole('button', { name: 'Export 2 logs' })).toBeInTheDocument();
  });

  it('says No filters for an empty query and shortens long project lists', () => {
    setup({ scope: { ...SCOPE, q: '', projectIds: ['p1', 'p2', 'p3', 'p4', 'p9'] } });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('No filters')).toBeInTheDocument();
    expect(within(dialog).getByText('Shop, Billing +3 more')).toBeInTheDocument();
  });

  it('pages with the cursor and the exact scope', async () => {
    getLogs
      .mockResolvedValueOnce(page(Array.from({ length: 1000 }, () => makeLog()), 'c2'))
      .mockResolvedValueOnce(page(Array.from({ length: 500 }, () => makeLog())));
    setup({ totalLogs: 5000 });
    const limit = screen.getByLabelText('Number of logs to export');
    await fireEvent.input(limit, { target: { value: '1500' } });
    await exportNow();
    await waitFor(() => expect(getLogs).toHaveBeenCalledTimes(2));
    expect(getLogs.mock.calls[0][0]).toEqual({
      projectId: ['p1', 'p2'],
      q: SCOPE.q,
      from: SCOPE.from,
      to: SCOPE.to,
      limit: 1000,
    });
    expect(getLogs.mock.calls[1][0]).toEqual({
      projectId: ['p1', 'p2'],
      q: SCOPE.q,
      from: SCOPE.from,
      to: SCOPE.to,
      limit: 500,
      cursor: 'c2',
    });
    for (const [params] of getLogs.mock.calls) {
      expect(params).not.toHaveProperty('offset');
      expect(params).not.toHaveProperty('searchMode');
    }
    const json = JSON.parse(await exportedText());
    expect(json).toHaveLength(1500);
    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Exported 1,500 logs'));
  });

  it('omits q when the query is empty', async () => {
    getLogs.mockResolvedValueOnce(page([makeLog()]));
    setup({ scope: { ...SCOPE, q: '' } });
    await exportNow();
    await waitFor(() => expect(getLogs).toHaveBeenCalledTimes(1));
    expect(getLogs.mock.calls[0][0]).not.toHaveProperty('q');
  });

  it('stops when there is no next cursor', async () => {
    getLogs.mockResolvedValueOnce(page([makeLog(), makeLog()]));
    setup({ totalLogs: 5000 });
    await fireEvent.input(screen.getByLabelText('Number of logs to export'), { target: { value: '3000' } });
    await exportNow();
    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Exported 2 logs'));
    expect(getLogs).toHaveBeenCalledTimes(1);
  });

  it('never exports more than asked for', async () => {
    getLogs.mockResolvedValueOnce(page(Array.from({ length: 5 }, () => makeLog()), 'c2'));
    setup({ totalLogs: 5000 });
    await fireEvent.input(screen.getByLabelText('Number of logs to export'), { target: { value: '3' } });
    await exportNow();
    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Exported 3 logs'));
    expect(getLogs).toHaveBeenCalledTimes(1);
    expect(getLogs.mock.calls[0][0]).toMatchObject({ limit: 3 });
  });

  it('writes project, host, session and custom columns to CSV', async () => {
    getLogs.mockResolvedValueOnce(
      page([
        makeLog({
          time: '2026-10-21T10:00:00.000Z',
          projectId: 'p1',
          service: 'api',
          level: 'error',
          message: 'boom',
          traceId: 't1',
          sessionId: 's1',
          hostname: 'web-1',
          metadata: { user: { id: 42 } },
        }),
        makeLog({ projectId: 'p9', hostname: null, metadata: { hostname: 'db-2', 'user.id': 'literal' } }),
      ]),
    );
    setup({ customColumns: ['user.id'] });
    await chooseCsv();
    await exportNow();
    const rows = parseCsv(await exportedText());
    expect(rows[0].join(',')).toBe('Time,Project,Service,Host,Level,Message,Trace ID,Session ID,user.id,Metadata');
    expect(rows[1]).toEqual([
      '2026-10-21T10:00:00.000Z',
      'Shop',
      'api',
      'web-1',
      'error',
      'boom',
      't1',
      's1',
      '42',
      '{"user":{"id":42}}',
    ]);
    // project id fallback, host from metadata, exact key beats the dot path
    expect(rows[2][1]).toBe('p9');
    expect(rows[2][3]).toBe('db-2');
    expect(rows[2][8]).toBe('literal');
    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('Exported 2 logs'));
  });

  it('escapes commas, quotes and newlines in CSV', async () => {
    getLogs.mockResolvedValueOnce(
      page([
        makeLog({ message: 'a, "b"\nc\r\nd', service: 'svc,x', metadata: { note: 'x"y' } }),
        makeLog({ message: '', metadata: null, level: 'trace' as LogEntry['level'], hostname: null }),
        makeLog({ message: 'x'.repeat(50_000), metadata: { hostname: 42 }, hostname: null }),
      ]),
    );
    setup({ totalLogs: 3, customColumns: ['missing', 'obj'] });
    await chooseCsv();
    await exportNow();
    const text = await exportedText();
    expect(text).toContain('"a, ""b""\nc\r\nd"');
    expect(text).toContain('"svc,x"');
    expect(text).toContain('"{""note"":""x\\""y""}"');
    const rows = parseCsv(text);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row).toHaveLength(11);
    // null metadata, unknown level, empty message
    expect(rows[2][4]).toBe('trace');
    expect(rows[2][5]).toBe('');
    expect(rows[2][10]).toBe('{}');
    // a numeric metadata.hostname is not a host; a 50 KB message stays whole
    expect(rows[3][3]).toBe('');
    expect(rows[3][5]).toHaveLength(50_000);
  });

  it('neutralises formula cells in CSV only', async () => {
    getLogs.mockResolvedValueOnce(
      page([
        makeLog({ message: '=cmd|calc', service: '+svc', metadata: { a: '@x', b: '-1+1', c: '\tTab' } }),
        makeLog({ message: '\rcr', service: 'safe=ok', metadata: null }),
      ]),
    );
    setup({ totalLogs: 2, customColumns: ['a', 'b', 'c'] });
    await chooseCsv();
    await exportNow();
    const rows = parseCsv(await exportedText());
    expect(rows[1][5]).toBe("'=cmd|calc");
    expect(rows[1][2]).toBe("'+svc");
    expect(rows[1].slice(8, 11)).toEqual(["'@x", "'-1+1", "'\tTab"]);
    expect(rows[2][5]).toBe("'\rcr");
    expect(rows[2][2]).toBe('safe=ok');
  });

  it('keeps JSON export raw', async () => {
    getLogs.mockResolvedValueOnce(page([makeLog({ message: '=cmd' })]));
    setup({ totalLogs: 1 });
    await exportNow();
    const text = await exportedText();
    expect(JSON.parse(text)[0].message).toBe('=cmd');
  });

  it('toasts without "successfully"', async () => {
    getLogs.mockResolvedValueOnce(page([makeLog(), makeLog()]));
    setup();
    await exportNow();
    await waitFor(() => expect(successSpy).toHaveBeenCalledTimes(1));
    expect(successSpy).toHaveBeenCalledWith('Exported 2 logs');
    expect(successSpy.mock.calls[0][0]).not.toMatch(/successfully|!/);
  });

  it('toasts a failure and keeps the dialog open', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getLogs.mockRejectedValueOnce(new Error('boom'));
    setup();
    await exportNow();
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Could not export logs'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(blobs).toHaveLength(0);
    consoleSpy.mockRestore();
  });

  it('disables the export without matching logs', () => {
    setup({ totalLogs: 0 });
    expect(screen.getByRole('button', { name: 'Export 0 logs' })).toBeDisabled();
  });
});
