import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import TerminalLogView from './TerminalLogView.svelte';
import { layoutStore } from '$lib/stores/layout';
import { displayPreferences } from '$lib/stores/display-preferences';
import { levelTone } from '$lib/utils/severity';
import { makeLog, resetLogIds } from './search/test-fixtures';
import type { LogEntry } from '$lib/api/logs';

const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

beforeEach(() => {
  resetLogIds();
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 420 });
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
  layoutStore.setTerminalWrap(true);
});

afterEach(() => {
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
  else delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  layoutStore.setTerminalWrap(true);
});

function manyLogs(n: number): LogEntry[] {
  return Array.from({ length: n }, (_, i) =>
    makeLog({ time: new Date(Date.UTC(2026, 9, 21, 10, 0, 0) - i * 1000).toISOString(), message: `line ${i}` }),
  );
}

function setup(props: Partial<{
  logs: LogEntry[];
  isLiveTail: boolean;
  selectedId: string | null;
  onSelect: (log: LogEntry) => void;
  onScrollTopChange: (atTop: boolean) => void;
}> = {}) {
  const onSelect = props.onSelect ?? vi.fn();
  const onScrollTopChange = props.onScrollTopChange ?? vi.fn();
  const utils = render(TerminalLogView, {
    props: { logs: props.logs ?? [makeLog()], ...props, onSelect, onScrollTopChange },
  });
  const container = () => utils.getByRole('log', { name: 'Terminal log viewer' });
  const lines = () => [...utils.container.querySelectorAll<HTMLElement>('.terminal-line')];
  return { ...utils, onSelect, onScrollTopChange, container, lines };
}

describe('TerminalLogView', () => {
  it('shows milliseconds', () => {
    const utils = setup();
    expect(utils.lines()[0]).toHaveTextContent('10:42:13.123');
    expect(utils.lines()[0]).toHaveTextContent('[Oct 21, 10:42:13.123]');
  });

  it('follows the display time zone and names it', async () => {
    const utils = setup();
    expect(utils.getByText('Times in UTC')).toBeInTheDocument();
    displayPreferences.set({ hour12: false, timeZone: 'Asia/Tokyo' });
    await tick();
    expect(utils.lines()[0]).toHaveTextContent('19:42:13.123');
    expect(utils.getByText('Times in UTC+9')).toBeInTheDocument();
  });

  it('opens details on click and Enter', async () => {
    const log = makeLog({ message: 'clicked line' });
    const utils = setup({ logs: [log] });
    const line = utils.getByRole('button', { name: /clicked line/ });
    await fireEvent.click(line);
    expect(utils.onSelect).toHaveBeenLastCalledWith(log);
    await fireEvent.keyDown(line, { key: 'Enter' });
    expect(utils.onSelect).toHaveBeenCalledTimes(2);
    await fireEvent.keyDown(line, { key: ' ' });
    expect(utils.onSelect).toHaveBeenCalledTimes(3);
    await fireEvent.keyDown(line, { key: 'a' });
    expect(utils.onSelect).toHaveBeenCalledTimes(3);
  });

  it('keeps Enter on a line from reaching page shortcuts', async () => {
    const utils = setup();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    await fireEvent.keyDown(utils.lines()[0], { key: 'Enter' });
    window.removeEventListener('keydown', onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
  });

  it('lines are focusable buttons', () => {
    const utils = setup();
    expect(utils.lines()[0]).toHaveAttribute('role', 'button');
    expect(utils.lines()[0]).toHaveAttribute('tabindex', '0');
  });

  it('marks the selected line', () => {
    const logs = [makeLog(), makeLog()];
    const utils = setup({ logs, selectedId: 'log-2' });
    expect(utils.lines()[1]).toHaveAttribute('aria-current', 'true');
    expect(utils.lines()[0]).not.toHaveAttribute('aria-current');
  });

  it('colours levels through the severity module', () => {
    const utils = setup({ logs: [makeLog({ level: 'critical', message: 'meltdown' })] });
    const cls = levelTone('critical').text.split(' ')[0];
    expect(utils.lines()[0].querySelector(`.${cls}`)).not.toBeNull();
    expect(utils.lines()[0].querySelector(`.terminal-message.${cls}`)).not.toBeNull();
  });

  it('windows lines in no-wrap mode', async () => {
    layoutStore.setTerminalWrap(false);
    const utils = setup({ logs: manyLogs(1000) });
    await tick();
    expect(utils.lines().length).toBeGreaterThan(0);
    expect(utils.lines().length).toBeLessThan(100);
    expect(utils.lines()[0]).toHaveTextContent('line 0');
    utils.container().scrollTop = 21 * 500;
    await fireEvent.scroll(utils.container());
    expect(utils.lines().length).toBeLessThan(100);
    expect(utils.lines().some((l) => l.textContent?.includes('line 500'))).toBe(true);
    expect(utils.lines().some((l) => l.textContent?.includes('line 0'))).toBe(false);
  });

  it('keeps one line per log in no-wrap mode', () => {
    layoutStore.setTerminalWrap(false);
    const utils = setup({ logs: [makeLog({ message: 'first\nsecond' })] });
    expect(utils.lines()[0].querySelector('.terminal-message')?.textContent).toBe('first\\nsecond');
  });

  it('renders every line in wrap mode', () => {
    const utils = setup({ logs: manyLogs(150) });
    expect(utils.lines()).toHaveLength(150);
    expect(utils.lines()[0].querySelector('.terminal-message')?.textContent).toBe('line 0');
  });

  it('reports scrolling away from the newest lines', async () => {
    const utils = setup({ logs: manyLogs(200) });
    utils.container().scrollTop = 200;
    await fireEvent.scroll(utils.container());
    expect(utils.onScrollTopChange).toHaveBeenLastCalledWith(false);
    utils.container().scrollTop = 10;
    await fireEvent.scroll(utils.container());
    expect(utils.onScrollTopChange).toHaveBeenLastCalledWith(true);
    expect(utils.onScrollTopChange).toHaveBeenCalledTimes(2);
  });

  it('jumps to the newest lines while live and at the top', async () => {
    const utils = setup({ logs: manyLogs(50), isLiveTail: true });
    utils.container().scrollTop = 30;
    await utils.rerender({ logs: manyLogs(60) });
    expect(utils.container().scrollTop).toBe(0);
  });

  it('stays put while live and scrolled away', async () => {
    const utils = setup({ logs: manyLogs(50), isLiveTail: true });
    utils.container().scrollTop = 300;
    await fireEvent.scroll(utils.container());
    await utils.rerender({ logs: manyLogs(60) });
    expect(utils.container().scrollTop).toBe(300);
  });

  it('scrollToTop() returns to the newest lines', async () => {
    const utils = setup({ logs: manyLogs(200) });
    utils.container().scrollTop = 400;
    await fireEvent.scroll(utils.container());
    (utils.component as unknown as { scrollToTop(): void }).scrollToTop();
    expect(utils.container().scrollTop).toBe(0);
    expect(utils.onScrollTopChange).toHaveBeenLastCalledWith(true);
  });

  it('shows the empty state', () => {
    const utils = setup({ logs: [] });
    expect(utils.getByText('No logs to display')).toBeInTheDocument();
  });

  it('renders odd logs', () => {
    const utils = setup({
      logs: [makeLog({ level: 'trace' as LogEntry['level'], metadata: null, time: 'not a date', message: '' })],
    });
    expect(utils.lines()).toHaveLength(1);
    expect(utils.lines()[0]).toHaveTextContent('TRACE');
  });
});
