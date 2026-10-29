import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { displayPreferences } from '$lib/stores/display-preferences';
import { severityTone } from '$lib/utils/severity';

// A tiny echarts stand in that records click handlers, so the heatmap cell
// click can be driven without a canvas.
const chartMock = vi.hoisted(() => {
	const handlers: Record<string, (params: unknown) => void> = {};
	const instance = {
		setOption: vi.fn(),
		resize: vi.fn(),
		dispose: vi.fn(),
		off: vi.fn(),
		on: vi.fn((name: string, fn: (params: unknown) => void) => {
			handlers[name] = fn;
		}),
	};
	return { handlers, instance };
});

vi.mock('echarts', () => ({
	init: vi.fn(() => chartMock.instance),
	graphic: { LinearGradient: class {} },
}));

import SeverityBadge from '../shared/SeverityBadge.svelte';
import TopThreatsCompact from './TopThreatsCompact.svelte';
import RecentEventsTable from './RecentEventsTable.svelte';
import StatsBar from './StatsBar.svelte';
import AffectedServicesCompact from './AffectedServicesCompact.svelte';
import AffectedServicesWidget from './AffectedServicesWidget.svelte';
import SeverityPieChart from './SeverityPieChart.svelte';
import MitreHeatmap from './MitreHeatmap.svelte';

beforeEach(() => {
	class RO {
		observe() {}
		disconnect() {}
		unobserve() {}
	}
	vi.stubGlobal('ResizeObserver', RO);
	displayPreferences.set({ hour12: false, timeZone: 'UTC' });
	vi.clearAllMocks();
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('SeverityBadge', () => {
	it('critical badge classes equal severityTone critical badge', () => {
		const { container } = render(SeverityBadge, { props: { severity: 'critical' } });
		const el = container.querySelector('span')!;
		for (const cls of severityTone('critical').badge.split(' ')) {
			expect(el.classList.contains(cls)).toBe(true);
		}
		expect(container.innerHTML).not.toMatch(/bg-(purple|red|orange|yellow)-/);
	});
});

describe('TopThreatsCompact', () => {
	it('bar uses the severityTone dot class and calls onThreatClick with the threat', async () => {
		const threat = {
			ruleId: 'r1',
			ruleTitle: 'Brute force',
			count: 1200,
			severity: 'high' as const,
			mitreTactics: null,
			mitreTechniques: null,
		};
		const onThreatClick = vi.fn();
		const { container, getByText } = render(TopThreatsCompact, {
			props: { threats: [threat], onThreatClick },
		});
		const bar = container.querySelector('[data-testid="threat-bar"]')!;
		expect(bar.classList.contains(severityTone('high').dot)).toBe(true);
		expect(getByText('1,200')).toBeTruthy();

		await fireEvent.click(getByText('Brute force'));
		expect(onThreatClick).toHaveBeenCalledWith(threat);
	});
});

describe('RecentEventsTable', () => {
	it('renders time through Timestamp with the zone in its title', () => {
		const event = {
			id: 'e1',
			time: '2026-03-05T21:07:09.047Z',
			ruleTitle: 'Rule one',
			service: 'api',
			severity: 'medium',
		} as never;
		const { container } = render(RecentEventsTable, { props: { events: [event] } });
		const time = container.querySelector('time')!;
		expect(time.getAttribute('datetime')).toBe('2026-03-05T21:07:09.047Z');
		expect(time.textContent).toBe('Mar 5, 21:07:09');
		expect(time.getAttribute('title')).toContain('UTC');
	});
});

describe('StatsBar', () => {
	it('severity dots use the severity module classes', () => {
		const { container } = render(StatsBar, {
			props: {
				stats: {
					severityDistribution: [{ severity: 'critical', count: 3 }],
					totalDetections: 1500,
					totalIncidents: 2,
					openIncidents: 1,
				} as never,
			},
		});
		const dots = [...container.querySelectorAll('[data-testid="severity-dot"]')];
		expect(dots).toHaveLength(4);
		expect(dots[0].classList.contains(severityTone('critical').dot)).toBe(true);
		expect(dots[1].classList.contains(severityTone('high').dot)).toBe(true);
		expect(container.innerHTML).not.toMatch(/bg-(purple|red|orange|blue)-500/);
	});
});

describe('affected services', () => {
	const service = { serviceName: 'api', detectionCount: 4200, criticalCount: 2, highCount: 1 } as never;

	it('compact bar and widget badges come from severityTone', () => {
		const compact = render(AffectedServicesCompact, { props: { services: [service] } });
		expect(compact.container.innerHTML).toContain(severityTone('critical').dot);
		compact.unmount();

		const widget = render(AffectedServicesWidget, { props: { services: [service] } });
		expect(widget.container.innerHTML).toContain(severityTone('critical').badge.split(' ')[0]);
		expect(widget.getByText('4,200')).toBeTruthy();
		expect(widget.container.innerHTML).not.toMatch(/bg-red-500/);
	});
});

describe('charts', () => {
	it('SeverityPieChart exposes a text alternative with totals', () => {
		const { getByRole } = render(SeverityPieChart, {
			props: {
				distribution: [
					{ severity: 'critical', count: 1000 },
					{ severity: 'low', count: 5 },
				] as never,
			},
		});
		expect(getByRole('img').getAttribute('aria-label')).toBe(
			'Severity distribution, 1,005 detections: 1,000 critical, 5 low'
		);
	});

	it('MitreHeatmap cell click calls onCellClick', () => {
		const cell = { technique: 'T1059', tactic: 'execution', count: 4 };
		const onCellClick = vi.fn();
		render(MitreHeatmap, { props: { cells: [cell], onCellClick } });

		const click = chartMock.handlers.click;
		expect(click).toBeTypeOf('function');
		click({ componentType: 'series', data: [0, 0, 4] });
		expect(onCellClick).toHaveBeenCalledWith(cell);
	});

	it('MitreHeatmap describes its data for assistive tech', () => {
		const { getByRole } = render(MitreHeatmap, {
			props: { cells: [{ technique: 'T1059', tactic: 'execution', count: 4 }] },
		});
		expect(getByRole('img').getAttribute('aria-label')).toContain('4 detections');
	});
});
