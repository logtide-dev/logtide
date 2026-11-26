import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import type { MetricCatalogEntry, MetricExplorerQuery } from '@logtide/shared';
import MetricQueryBuilder from './MetricQueryBuilder.svelte';
import BreakdownSuggestions from './BreakdownSuggestions.svelte';
import { defaultExplorerQuery } from '$lib/utils/metrics-explorer-url';
import { chooseSelectOption } from '$lib/test-utils/select-field';

const catalog: MetricCatalogEntry[] = [
  { name: 'system.cpu.utilization.total', type: 'gauge', unit: '%', description: null, isMonotonic: null, temporality: null, projectIds: ['p'], firstSeen: '', lastSeen: '' },
  { name: 'http.requests', type: 'sum', unit: '{request}', description: null, isMonotonic: true, temporality: 'cumulative', projectIds: ['p'], firstSeen: '', lastSeen: '' },
];

function makeApi() {
  return {
    getCatalog: vi.fn().mockResolvedValue({ metrics: catalog }),
    getAttributes: vi.fn().mockResolvedValue(['host.name', 'service.name']),
    getAttributeValues: vi.fn().mockResolvedValue(['web-1', 'web-2']),
  };
}

function setup(value: MetricExplorerQuery = defaultExplorerQuery(), extra: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const api = makeApi();
  const view = render(MetricQueryBuilder, { value, onChange, organizationId: 'org', catalog, api, debounceMs: 0, ...extra });
  return { onChange, api, ...view };
}

const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0] as MetricExplorerQuery;

async function pickMetric(name: string, id = 'A') {
  const input = screen.getByRole('combobox', { name: `Metric ${id}` });
  await fireEvent.focus(input);
  await fireEvent.click(await screen.findByRole('option', { name: new RegExp(name.replace(/\./g, '\\.')) }));
}

beforeEach(() => vi.clearAllMocks());

/** Label, how series are combined and remove live in the row menu. */
async function openMore(id = 'A') {
  await fireEvent.click(screen.getByRole('button', { name: `More options for query ${id}` }));
}

describe('MetricQueryBuilder queries', () => {
  it('picks a metric from the catalog showing type and unit', async () => {
    const { onChange } = setup();
    const input = screen.getByRole('combobox', { name: 'Metric A' });
    await fireEvent.focus(input);
    const option = await screen.findByRole('option', { name: /system\.cpu\.utilization\.total/ });
    expect(option).toHaveTextContent('gauge');
    expect(option).toHaveTextContent('%');
    await fireEvent.click(option);
    expect(last(onChange).queries[0].metricName).toBe('system.cpu.utilization.total');
  });

  it('accepts a typed metric name that is not in the catalog', async () => {
    const { onChange } = setup();
    const input = screen.getByRole('combobox', { name: 'Metric A' });
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'custom.metric' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(last(onChange).queries[0].metricName).toBe('custom.metric');
  });

  it('adds and removes queries up to six', async () => {
    const { onChange } = setup();
    expect(screen.queryByRole('button', { name: /Remove query/ })).toBeNull();
    for (let i = 0; i < 5; i++) await fireEvent.click(screen.getByRole('button', { name: 'Add query' }));
    expect(last(onChange).queries.map((q) => q.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(screen.getByRole('button', { name: 'Add query' })).toBeDisabled();
    await openMore('C');
    await fireEvent.click(await screen.findByRole('button', { name: 'Remove query C' }));
    expect(last(onChange).queries.map((q) => q.id)).toEqual(['A', 'B', 'D', 'E', 'F']);
    await fireEvent.click(screen.getByRole('button', { name: 'Add query' }));
    expect(last(onChange).queries.map((q) => q.id)).toContain('C');
  });

  it('hides a query', async () => {
    const { onChange } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Hide query A' }));
    expect(last(onChange).queries[0].hidden).toBe(true);
    expect(screen.getByRole('button', { name: 'Show query A' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sets the label', async () => {
    const { onChange } = setup();
    await openMore();
    await fireEvent.input(await screen.findByLabelText('Label A'), { target: { value: 'CPU' } });
    expect(last(onChange).queries[0].label).toBe('CPU');
  });

  it('changes the time and space aggregation', async () => {
    const { onChange } = setup();
    await chooseSelectOption(screen.getByRole('combobox', { name: 'Time aggregation A' }), 'p95');
    expect(last(onChange).queries[0].aggregation).toBe('p95');
    await openMore();
    await chooseSelectOption(await screen.findByRole('combobox', { name: 'Space aggregation A' }), 'sum');
    expect(last(onChange).queries[0].spaceAggregation).toBe('sum');
  });

  it('debounces onChange', async () => {
    vi.useFakeTimers();
    try {
      const { onChange } = setup(defaultExplorerQuery(), { debounceMs: 300 });
      await openMore();
      await fireEvent.input(screen.getByLabelText('Label A'), { target: { value: 'a' } });
      await fireEvent.input(screen.getByLabelText('Label A'), { target: { value: 'ab' } });
      expect(onChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(last(onChange).queries[0].label).toBe('ab');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MetricQueryBuilder filters', () => {
  async function openFilter() {
    await fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
  }

  it('adds a filter with key and value autocomplete', async () => {
    const { onChange, api } = setup();
    await pickMetric('http.requests');
    await openFilter();
    await waitFor(() => expect(api.getAttributes).toHaveBeenCalled());
    // Source attributes (host.name, service.name) are what people filter on most.
    expect(api.getAttributes.mock.calls.at(-1)![0]).toMatchObject({ scope: 'resource', metricName: 'http.requests', organizationId: 'org' });

    const key = screen.getByRole('combobox', { name: 'Filter key A' });
    await fireEvent.focus(key);
    await fireEvent.click(await screen.findByRole('option', { name: 'host.name' }));
    const val = screen.getByRole('combobox', { name: 'Filter value A' });
    await fireEvent.focus(val);
    await fireEvent.click(await screen.findByRole('option', { name: 'web-1' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(last(onChange).queries[0].filters).toEqual([{ scope: 'resource', key: 'host.name', op: 'eq', values: ['web-1'] }]);
    expect(screen.getByText('host.name = web-1')).toBeInTheDocument();
  });

  it('switching scope to data point reloads keys with that scope', async () => {
    const { api } = setup();
    await openFilter();
    await chooseSelectOption(screen.getByRole('combobox', { name: 'Filter scope A' }), 'Data point');
    await waitFor(() => expect(api.getAttributes.mock.calls.at(-1)![0]).toMatchObject({ scope: 'metric' }));
  });

  it('exists needs no value and shows no value input', async () => {
    const { onChange } = setup();
    await openFilter();
    const key = screen.getByRole('combobox', { name: 'Filter key A' });
    await fireEvent.focus(key);
    await fireEvent.click(await screen.findByRole('option', { name: 'service.name' }));
    await chooseSelectOption(screen.getByRole('combobox', { name: 'Filter operator A' }), 'exists');
    expect(screen.queryByRole('combobox', { name: 'Filter value A' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(last(onChange).queries[0].filters[0]).toEqual({ scope: 'resource', key: 'service.name', op: 'exists' });
  });

  it('in takes several values', async () => {
    const { onChange } = setup();
    await openFilter();
    const key = screen.getByRole('combobox', { name: 'Filter key A' });
    await fireEvent.focus(key);
    await fireEvent.click(await screen.findByRole('option', { name: 'host.name' }));
    await chooseSelectOption(screen.getByRole('combobox', { name: 'Filter operator A' }), 'is one of');
    for (const v of ['web-1', 'web-2']) {
      await fireEvent.focus(screen.getByRole('combobox', { name: 'Filter value A' }));
      await fireEvent.click(await screen.findByRole('option', { name: v }));
    }
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(last(onChange).queries[0].filters[0].values).toEqual(['web-1', 'web-2']);
  });

  it('offers $variables as values only when variables are given', async () => {
    setup(defaultExplorerQuery(), { variables: [{ name: 'host', label: 'Host', attr: { scope: 'resource', key: 'host.name' }, default: null }] });
    await openFilter();
    const key = screen.getByRole('combobox', { name: 'Filter key A' });
    await fireEvent.focus(key);
    await fireEvent.click(await screen.findByRole('option', { name: 'host.name' }));
    await fireEvent.focus(screen.getByRole('combobox', { name: 'Filter value A' }));
    expect(await screen.findByRole('option', { name: /\$host/ })).toBeInTheDocument();
  });

  it('does not offer variables without the prop', async () => {
    setup();
    await openFilter();
    const key = screen.getByRole('combobox', { name: 'Filter key A' });
    await fireEvent.focus(key);
    await fireEvent.click(await screen.findByRole('option', { name: 'host.name' }));
    await fireEvent.focus(screen.getByRole('combobox', { name: 'Filter value A' }));
    await screen.findByRole('option', { name: 'web-1' });
    expect(screen.queryByRole('option', { name: /\$/ })).toBeNull();
  });

  it('removes a filter chip', async () => {
    const q = defaultExplorerQuery();
    q.queries[0].filters = [{ scope: 'resource', key: 'host.name', op: 'eq', values: ['a'] }];
    const { onChange } = setup(q);
    await fireEvent.click(screen.getByRole('button', { name: /Remove filter host\.name = a/ }));
    expect(last(onChange).queries[0].filters).toEqual([]);
  });

  it('keeps Add disabled until the filter is complete', async () => {
    setup();
    await openFilter();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });
});

describe('MetricQueryBuilder group by and display', () => {
  async function addGroup(scopeLabel: string, key: string) {
    await fireEvent.click(screen.getByRole('button', { name: 'Add group by' }));
    await chooseSelectOption(screen.getByRole('combobox', { name: 'Group by scope A' }), scopeLabel);
    const input = screen.getByRole('combobox', { name: 'Group by key A' });
    await fireEvent.focus(input);
    await fireEvent.click(await screen.findByRole('option', { name: key }));
  }

  it('groups by a resource source attribute and defaults the display to split', async () => {
    const { onChange } = setup();
    await addGroup('Source', 'host.name');
    const q = last(onChange);
    expect(q.queries[0].groupBy).toEqual([{ scope: 'resource', key: 'host.name' }]);
    expect(q.display).toBe('split');
    expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps lines when grouping by a metric attribute', async () => {
    const { onChange } = setup();
    await addGroup('Data point', 'service.name');
    expect(last(onChange).display).toBe('lines');
  });

  it('removing the group by returns to lines and clears top N', async () => {
    const q = defaultExplorerQuery();
    q.queries[0].groupBy = [{ scope: 'resource', key: 'host.name' }];
    q.queries[0].limit = 5;
    q.display = 'split';
    const { onChange } = setup(q);
    await fireEvent.click(screen.getByRole('button', { name: 'Remove group by host.name' }));
    expect(last(onChange).display).toBe('lines');
    expect(last(onChange).queries[0].limit).toBeUndefined();
  });

  it('respects a display the user picked', async () => {
    const { onChange } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(last(onChange).display).toBe('table');
    await addGroup('Source', 'host.name');
    expect(last(onChange).display).toBe('table');
  });

  it('limits group by to three', () => {
    const q = defaultExplorerQuery();
    q.queries[0].groupBy = [
      { scope: 'metric', key: 'a' },
      { scope: 'metric', key: 'b' },
      { scope: 'metric', key: 'c' },
    ];
    setup(q);
    expect(screen.queryByRole('button', { name: 'Add group by' })).toBeNull();
  });

  it('sets and clamps top N', async () => {
    const q = defaultExplorerQuery();
    q.queries[0].groupBy = [{ scope: 'metric', key: 'a' }];
    const { onChange } = setup(q);
    await fireEvent.change(screen.getByLabelText('Top N A'), { target: { value: '500' } });
    expect(last(onChange).queries[0].limit).toBe(50);
  });
});

describe('MetricQueryBuilder formulas and footer', () => {
  it('explains how metric queries work in a help popover', async () => {
    setup();
    await fireEvent.click(screen.getByRole('button', { name: 'How metric queries work' }));
    expect(await screen.findByText('Metric queries')).toBeInTheDocument();
    expect(screen.getByText('A / B * 100')).toBeInTheDocument();
  });

  it('adds a formula with validation hints', async () => {
    const { onChange } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Add formula' }));
    const input = screen.getByLabelText('Expression F1');
    await fireEvent.input(input, { target: { value: 'A / Z' } });
    expect(last(onChange).formulas[0]).toMatchObject({ id: 'F1', expression: 'A / Z' });
    expect(screen.getByText('Unknown query Z')).toBeInTheDocument();
    await fireEvent.input(input, { target: { value: 'A * 100' } });
    expect(screen.getByText(/Use query letters/)).toBeInTheDocument();
  });

  it('removes a formula and caps at four', async () => {
    const { onChange } = setup();
    for (let i = 0; i < 4; i++) await fireEvent.click(screen.getByRole('button', { name: 'Add formula' }));
    expect(screen.getByRole('button', { name: 'Add formula' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove formula F2' }));
    expect(last(onChange).formulas.map((f) => f.id)).toEqual(['F1', 'F3', 'F4']);
  });

  it('changes interval and compare to', async () => {
    const { onChange } = setup();
    await chooseSelectOption(screen.getByRole('combobox', { name: 'Interval' }), '5 minutes');
    expect(last(onChange).interval).toBe('5m');
    await chooseSelectOption(screen.getByRole('combobox', { name: 'Compare to' }), 'Previous day');
    expect(last(onChange).compareTo).toBe('1d');
  });

  it('can hide the display toggle', () => {
    setup(defaultExplorerQuery(), { showDisplay: false });
    expect(screen.queryByRole('group', { name: 'Display' })).toBeNull();
  });

  it('replaces the draft when the value prop changes externally', async () => {
    const { rerender } = setup();
    const next = defaultExplorerQuery();
    next.queries[0].metricName = 'from.link';
    next.queries[0].label = 'Linked';
    await rerender({ value: next });
    await openMore();
    expect(((await screen.findByLabelText('Label A')) as HTMLInputElement).value).toBe('Linked');
  });

  it('loads the catalog itself when none is given', async () => {
    const onChange = vi.fn();
    const api = makeApi();
    render(MetricQueryBuilder, { value: defaultExplorerQuery(), onChange, organizationId: 'org', api, debounceMs: 0 });
    await waitFor(() => expect(api.getCatalog).toHaveBeenCalledWith({ organizationId: 'org', projectIds: null }));
    await fireEvent.focus(screen.getByRole('combobox', { name: 'Metric A' }));
    expect(await screen.findByRole('option', { name: /http\.requests/ })).toBeInTheDocument();
  });

  it('shows a hint when the catalog fails', async () => {
    const api = makeApi();
    api.getCatalog.mockRejectedValue(new Error('nope'));
    render(MetricQueryBuilder, { value: defaultExplorerQuery(), onChange: vi.fn(), organizationId: 'org', api });
    expect(await screen.findByText(/nope/)).toBeInTheDocument();
  });
});

describe('BreakdownSuggestions', () => {
  const detail = {
    entry: catalog[0],
    attributes: {
      metric: [
        { key: 'state', values: ['user', 'system', 'idle'] },
        { key: 'one', values: ['x'] },
      ],
      resource: [
        { key: 'host.name', values: ['a', 'b'] },
        { key: 'deployment.environment', values: ['prod', 'dev', 'qa', 'x'] },
      ],
    },
    sources: { hosts: [], services: [] },
    usedIn: { dashboards: [] },
  };

  it('lists keys with value counts, source attributes first, and adds a group by on click', async () => {
    const api = { getCatalogEntry: vi.fn().mockResolvedValue(detail) };
    const onAddGroupBy = vi.fn();
    render(BreakdownSuggestions, { metricName: 'm', organizationId: 'org', api, onAddGroupBy });
    const list = await screen.findByRole('list');
    const items = within(list).getAllByRole('button');
    expect(items[0]).toHaveTextContent('resource.host.name');
    expect(items[0]).toHaveTextContent('2 values');
    expect(items[1]).toHaveTextContent('resource.deployment.environment');
    expect(items.at(-1)).toHaveTextContent('one');
    expect(items.at(-1)).toHaveTextContent('1 value');
    await fireEvent.click(items[0]);
    expect(onAddGroupBy).toHaveBeenCalledWith({ scope: 'resource', key: 'host.name' });
    expect(api.getCatalogEntry).toHaveBeenCalledWith('m', { organizationId: 'org', projectIds: null });
  });

  it('respects max', async () => {
    const api = { getCatalogEntry: vi.fn().mockResolvedValue(detail) };
    render(BreakdownSuggestions, { metricName: 'm', organizationId: 'org', api, onAddGroupBy: vi.fn(), max: 2 });
    expect(await screen.findAllByRole('button')).toHaveLength(2);
  });

  it('renders nothing without a metric', () => {
    const api = { getCatalogEntry: vi.fn() };
    render(BreakdownSuggestions, { metricName: '', organizationId: 'org', api, onAddGroupBy: vi.fn() });
    expect(screen.queryByRole('region')).toBeNull();
    expect(api.getCatalogEntry).not.toHaveBeenCalled();
  });

  it('shows an error', async () => {
    const api = { getCatalogEntry: vi.fn().mockRejectedValue(new Error('gone')) };
    render(BreakdownSuggestions, { metricName: 'm', organizationId: 'org', api, onAddGroupBy: vi.fn() });
    expect(await screen.findByRole('alert')).toHaveTextContent('gone');
  });

  it('shows an empty message', async () => {
    const api = { getCatalogEntry: vi.fn().mockResolvedValue({ ...detail, attributes: { metric: [], resource: [] } }) };
    render(BreakdownSuggestions, { metricName: 'm', organizationId: 'org', api, onAddGroupBy: vi.fn() });
    expect(await screen.findByText(/no attributes/)).toBeInTheDocument();
  });
});
