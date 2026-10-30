import { describe, it, expect, afterEach } from 'vitest';
import { chartColors, getEChartsTheme, levelColor, severityColor, stateColor } from './echarts-theme';
import { levelTone, severityTone, stateTone } from './severity';

afterEach(() => {
  document.documentElement.classList.remove('dark');
  for (const v of ['--popover', '--border', '--muted-foreground', '--popover-foreground']) {
    document.documentElement.style.removeProperty(v);
  }
});

describe('chart colors', () => {
  it('derives severity colors from the severity module', () => {
    expect(chartColors.severity.high).toBe(severityTone('high').chart);
    expect(chartColors.severity.critical).toBe(severityTone('critical').chart);
    expect(chartColors.severity.low).toBe(severityTone('low').chart);
    expect(chartColors.severity.informational).toBe(severityTone('informational').chart);
  });

  it('medium is amber, not orange', () => {
    expect(chartColors.severity.medium).toBe('#f59e0b');
  });

  it('keeps all series keys', () => {
    expect(Object.keys(chartColors.series).sort()).toEqual(
      ['amber', 'blue', 'gray', 'green', 'orange', 'purple', 'red', 'yellow'],
    );
    expect(chartColors.series.red).toBe(levelTone('error').chart);
    expect(chartColors.series.green).toBe(stateTone('ok').chart);
  });

  it('exposes level, severity and state helpers', () => {
    expect(levelColor('warn')).toBe(levelTone('warn').chart);
    expect(severityColor('high')).toBe(severityTone('high').chart);
    expect(stateColor('resolved')).toBe(stateTone('resolved').chart);
  });
});

describe('getEChartsTheme', () => {
  it('returns the fallback palette when css vars are absent', () => {
    const t = getEChartsTheme();
    expect(t.tooltipBackground).toBe('#ffffff');
    expect(t.tooltipBorder).toBe('#e4e4e7');
    expect(t.textColor).toBe('#71717a');
    document.documentElement.classList.add('dark');
    const d = getEChartsTheme();
    expect(d.tooltipBackground).toBe('#18181b');
  });

  it('reads hsl strings from css variables', () => {
    document.documentElement.style.setProperty('--popover', '240 8% 8%');
    document.documentElement.style.setProperty('--border', '240 6% 16%');
    document.documentElement.style.setProperty('--muted-foreground', '240 5% 65%');
    const t = getEChartsTheme();
    expect(t.tooltipBackground).toBe('hsl(240 8% 8%)');
    expect(t.tooltipBorder).toBe('hsl(240 6% 16%)');
    expect(t.textColor).toBe('hsl(240 5% 65%)');
  });

  it('isDark follows the dark class', () => {
    expect(getEChartsTheme().isDark).toBe(false);
    document.documentElement.classList.add('dark');
    expect(getEChartsTheme().isDark).toBe(true);
  });
});
