import { browser } from '$app/environment';

/**
 * Chart color palette - semantic colors that work in both light and dark modes.
 * These colors are chosen for WCAG AA compliance (4.5:1 contrast ratio).
 */
export const chartColors = {
  // Series colors - used for data visualization
  series: {
    blue: '#3b82f6',      // Blue-500 - primary data
    red: '#ef4444',       // Red-500 - errors, destructive
    amber: '#f59e0b',     // Amber-500 - warnings
    green: '#10b981',     // Emerald-500 - success, info
    purple: '#a855f7',    // Purple-500 - severity critical
    orange: '#f97316',    // Orange-500 - severity high
    yellow: '#eab308',    // Yellow-500 - severity medium
    gray: '#6b7280',      // Gray-500 - informational
  },

  // Severity colors (for SIEM)
  severity: {
    critical: '#a855f7',  // Purple
    high: '#ef4444',      // Red
    medium: '#f97316',    // Orange
    low: '#eab308',       // Yellow
    informational: '#3b82f6', // Blue
  },

  // Gradient stops for heatmaps
  gradient: {
    low: '#1e3a5f',       // Dark blue
    medium: '#3b82f6',    // Blue-500
    high: '#ef4444',      // Red-500
    critical: '#991b1b',  // Red-900
  },
} as const;

/**
 * Get theme-aware colors for ECharts based on current document theme.
 * Reads CSS variables from the document root.
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
      isDark: true,
    };
  }

  const isDark = document.documentElement.classList.contains('dark');

  return {
    // Text colors
    textColor: isDark ? '#a1a1aa' : '#71717a',

    // Axis and grid lines
    axisLineColor: isDark ? '#27272a' : '#e4e4e7',
    splitLineColor: isDark ? '#27272a' : '#e4e4e7',

    // Backgrounds
    backgroundColor: 'transparent',
    tooltipBackground: isDark ? '#18181b' : '#ffffff',
    tooltipBorder: isDark ? '#27272a' : '#e4e4e7',

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
      color: theme.isDark ? '#fafafa' : '#18181b',
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
