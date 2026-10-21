import { browser } from '$app/environment';
import { levelTone, severityTone, stateTone } from './severity';

/** Chart hex for a log level (single source: the severity module). */
export function levelColor(level: string): string {
  return levelTone(level).chart;
}

/** Chart hex for a SIEM severity. */
export function severityColor(sev: string): string {
  return severityTone(sev).chart;
}

/** Chart hex for a state (open, resolved, up, down, ...). */
export function stateColor(state: string): string {
  return stateTone(state).chart;
}

/**
 * Chart color palette - semantic colors that work in both light and dark modes.
 * The red/amber/green/purple/blue/gray hexes come from the severity module so
 * charts and badges share one palette.
 */
export const chartColors = {
  // Series colors - used for data visualization
  series: {
    blue: levelColor('info'),
    red: levelColor('error'),
    amber: levelColor('warn'),
    green: stateColor('ok'),
    purple: levelColor('critical'),
    orange: '#f97316',    // Orange-500 - not part of the severity palette
    yellow: '#eab308',    // Yellow-500 - not part of the severity palette
    gray: levelColor('debug'),
  },

  // Severity colors (for SIEM)
  severity: {
    critical: severityColor('critical'),
    high: severityColor('high'),
    medium: severityColor('medium'),
    low: severityColor('low'),
    informational: severityColor('informational'),
  },

  // Gradient stops for heatmaps
  gradient: {
    low: '#1e3a5f',       // Dark blue
    medium: '#3b82f6',    // Blue-500
    high: '#ef4444',      // Red-500
    critical: '#991b1b',  // Red-900
  },
} as const;

/** Read a CSS variable (HSL triplet) from the root and wrap it as hsl(...). */
function cssColor(name: string, fallback: string): string {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return raw ? `hsl(${raw})` : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Get theme-aware colors for ECharts based on current document theme.
 * Tooltip colours read the CSS variables from the document root, falling back
 * to fixed values when they are empty (jsdom, SSR).
 */
export function getEChartsTheme() {
  if (!browser) {
    // SSR fallback - return dark theme defaults
    return {
      textColor: '#a1a1aa',
      axisLineColor: '#27272a',
      splitLineColor: '#27272a',
      backgroundColor: 'transparent',
      tooltipBackground: '#18181b',
      tooltipBorder: '#27272a',
      tooltipText: '#fafafa',
      mutedText: '#a1a1aa',
      isDark: true,
    };
  }

  const isDark = document.documentElement.classList.contains('dark');

  return {
    // Text colors
    textColor: cssColor('--muted-foreground', isDark ? '#a1a1aa' : '#71717a'),

    // Axis and grid lines
    axisLineColor: isDark ? '#27272a' : '#e4e4e7',
    splitLineColor: isDark ? '#27272a' : '#e4e4e7',

    // Backgrounds
    backgroundColor: 'transparent',
    tooltipBackground: cssColor('--popover', isDark ? '#18181b' : '#ffffff'),
    tooltipBorder: cssColor('--border', isDark ? '#27272a' : '#e4e4e7'),
    tooltipText: cssColor('--popover-foreground', isDark ? '#fafafa' : '#18181b'),
    mutedText: cssColor('--muted-foreground', isDark ? '#a1a1aa' : '#71717a'),

    // Theme indicator
    isDark,
  };
}

/**
 * Get common ECharts axis style options based on current theme.
 */
export function getAxisStyle() {
  const theme = getEChartsTheme();

  return {
    axisLabel: {
      color: theme.textColor,
      fontSize: 11,
    },
    axisLine: {
      lineStyle: {
        color: theme.axisLineColor,
      },
    },
    splitLine: {
      lineStyle: {
        color: theme.splitLineColor,
      },
    },
  };
}

/**
 * Get common ECharts tooltip style options based on current theme.
 */
export function getTooltipStyle() {
  const theme = getEChartsTheme();

  return {
    backgroundColor: theme.tooltipBackground,
    borderColor: theme.tooltipBorder,
    textStyle: {
      color: theme.tooltipText,
    },
  };
}

/**
 * Get common ECharts legend style options based on current theme.
 */
export function getLegendStyle() {
  const theme = getEChartsTheme();

  return {
    textStyle: {
      color: theme.textColor,
    },
  };
}
