import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import FacetSidebar from './FacetSidebar.svelte';
import type { LogFacet } from '$lib/api/logs';

const FACETS: LogFacet[] = [
  { field: 'service', values: [{ value: 'worker', count: 40 }, { value: 'api', count: 12345 }], otherCount: 0 },
  {
    field: 'level',
    values: [
      { value: 'info', count: 900 },
      { value: 'error', count: 3 },
      { value: 'debug', count: 1200 },
    ],
    otherCount: 0,
  },
  { field: 'host', values: [{ value: 'web-1', count: 7 }], otherCount: 15 },
  { field: 'user.id', values: [{ value: '42', count: 2 }], otherCount: 0 },
  { field: 'env', values: [{ value: 'prod', count: 9 }], otherCount: 0 },
];

function setup(props: Partial<{
  facets: LogFacet[];
  loading: boolean;
  error: string | null;
  q: string;
  pinnedKeys: string[];
  candidateKeys: string[];
  collapsed: boolean;
}> = {}) {
  const onToggle = vi.fn();
  const onPin = vi.fn();
  const onUnpin = vi.fn();
  const utils = render(FacetSidebar, {
    props: {
      facets: props.facets ?? FACETS,
      loading: props.loading ?? false,
      error: props.error ?? null,
      q: props.q ?? '',
      pinnedKeys: props.pinnedKeys ?? ['env'],
      candidateKeys: props.candidateKeys ?? ['user.id', 'env', 'region'],
      collapsed: props.collapsed ?? false,
      onToggle,
      onPin,
      onUnpin,
    },
  });
  return { ...utils, onToggle, onPin, onUnpin };
}

function valueButton(utils: ReturnType<typeof setup>, key: string, value: string): HTMLElement {
  return utils.getByRole('button', { name: new RegExp(`^${key} ${value} \\(`) });
}

describe('FacetSidebar', () => {
  it('renders Level, Service and Host with en-US counts', () => {
    const utils = setup();
    const headings = utils.getAllByRole('heading').map((h) => h.textContent?.trim());
    expect(headings.slice(0, 3)).toEqual(['Level', 'Service', 'Host']);
    expect(valueButton(utils, 'service', 'api')).toHaveTextContent('12,345');
    expect(valueButton(utils, 'service', 'api')).toHaveAccessibleName('service api (12,345 logs)');
    expect(valueButton(utils, 'level', 'error')).toHaveAccessibleName('level error (3 logs)');
  });

  it('orders level values by severity and other values by count', () => {
    const utils = setup();
    const level = utils.getByRole('region', { name: 'Level' });
    const levelNames = within(level)
      .getAllByRole('button', { pressed: false })
      .map((b) => b.getAttribute('aria-label'));
    expect(levelNames).toEqual(['level debug (1,200 logs)', 'level info (900 logs)', 'level error (3 logs)']);
    const service = utils.getByRole('region', { name: 'Service' });
    const serviceNames = within(service)
      .getAllByRole('button', { pressed: false })
      .map((b) => b.getAttribute('aria-label'));
    expect(serviceNames).toEqual(['service api (12,345 logs)', 'service worker (40 logs)']);
  });

  it('shows metadata keys in monospace after the built-ins', () => {
    const utils = setup();
    const headings = utils.getAllByRole('heading').map((h) => h.textContent?.trim());
    expect(headings).toEqual(['Level', 'Service', 'Host', 'user.id', 'env']);
    expect(utils.getByRole('heading', { name: 'user.id' }).className).toContain('font-mono');
  });

  it('clicking a value includes it', async () => {
    const utils = setup();
    await fireEvent.click(valueButton(utils, 'service', 'api'));
    expect(utils.onToggle).toHaveBeenCalledWith('service', 'api', 'include');
  });

  it('the value menu offers Exclude', async () => {
    const utils = setup();
    await fireEvent.click(utils.getByRole('button', { name: 'More actions for service api' }));
    await tick();
    await fireEvent.click(await utils.findByRole('button', { name: 'Exclude' }));
    expect(utils.onToggle).toHaveBeenCalledWith('service', 'api', 'exclude');
  });

  it('the value menu offers Include', async () => {
    const utils = setup();
    await fireEvent.click(utils.getByRole('button', { name: 'More actions for host web-1' }));
    await tick();
    await fireEvent.click(await utils.findByRole('button', { name: 'Include' }));
    expect(utils.onToggle).toHaveBeenCalledWith('host', 'web-1', 'include');
  });

  it('marks values included or excluded by q', () => {
    const utils = setup({ q: 'level:error -service:api' });
    expect(valueButton(utils, 'level', 'error')).toHaveAttribute('aria-pressed', 'true');
    expect(valueButton(utils, 'level', 'info')).toHaveAttribute('aria-pressed', 'false');
    const apiRow = valueButton(utils, 'service', 'api').closest('[data-state]');
    expect(apiRow).toHaveAttribute('data-state', 'excluded');
    expect(apiRow?.querySelector('.line-through')).not.toBeNull();
    expect(valueButton(utils, 'service', 'worker').closest('[data-state]')).toHaveAttribute('data-state', 'none');
  });

  it('marks values from aliases and in-lists', () => {
    const utils = setup({ q: 'hostname:web-1 env:(prod OR dev)' });
    expect(valueButton(utils, 'host', 'web-1')).toHaveAttribute('aria-pressed', 'true');
    expect(valueButton(utils, 'env', 'prod')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows Other with its count', () => {
    const utils = setup();
    const host = utils.getByRole('region', { name: 'Host' });
    expect(within(host).getByText('Other').parentElement).toHaveTextContent('15');
    const service = utils.getByRole('region', { name: 'Service' });
    expect(within(service).queryByText('Other')).toBeNull();
  });

  it('pins and unpins metadata keys', async () => {
    const utils = setup();
    await fireEvent.click(utils.getByRole('button', { name: 'Pin user.id' }));
    expect(utils.onPin).toHaveBeenCalledWith('user.id');
    await fireEvent.click(utils.getByRole('button', { name: 'Unpin env' }));
    expect(utils.onUnpin).toHaveBeenCalledWith('env');
    expect(utils.queryByRole('button', { name: /^(Pin|Unpin) (service|host|level)$/ })).toBeNull();

    await fireEvent.click(utils.getByRole('button', { name: 'Add facet' }));
    await tick();
    const region = await utils.findByRole('button', { name: 'region' });
    expect(utils.queryByRole('button', { name: 'user.id' })).toBeNull();
    await fireEvent.click(region);
    expect(utils.onPin).toHaveBeenCalledWith('region');
  });

  it('collapses', async () => {
    const utils = setup();
    await fireEvent.click(utils.getByRole('button', { name: 'Collapse facets' }));
    await tick();
    expect(utils.queryByRole('heading', { name: 'Service' })).toBeNull();
    expect(utils.getByRole('button', { name: 'Expand facets' })).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(utils.getByRole('button', { name: 'Expand facets' }));
    await tick();
    expect(utils.getByRole('heading', { name: 'Service' })).toBeInTheDocument();
  });

  it('shows loading and error states', () => {
    const loading = setup({ facets: [], loading: true });
    expect(loading.getByText('Loading facets')).toBeInTheDocument();
    loading.unmount();
    const failed = setup({ facets: [], error: 'Failed to load facets: Bad Gateway' });
    expect(failed.getByText('Could not load facets')).toBeInTheDocument();
    expect(failed.getByText('Failed to load facets: Bad Gateway')).toBeInTheDocument();
  });

  it('shows an empty value as (empty) and a facet without values', () => {
    const utils = setup({
      facets: [
        { field: 'service', values: [{ value: '', count: 4 }], otherCount: 0 },
        { field: 'host', values: [], otherCount: 0 },
      ],
    });
    const empty = valueButton(utils, 'service', String.raw`\(empty\)`);
    expect(empty).toHaveAccessibleName('service (empty) (4 logs)');
    expect(empty).toHaveTextContent('(empty)');
    const host = utils.getByRole('region', { name: 'Host' });
    expect(within(host).getByText('No values')).toBeInTheDocument();
  });
});
