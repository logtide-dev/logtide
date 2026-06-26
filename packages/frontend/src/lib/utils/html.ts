/**
 * Escape a value for safe interpolation into an HTML string.
 *
 * Use this anywhere user- or telemetry-derived text is placed into raw HTML
 * markup (e.g. ECharts tooltip.formatter output, exported HTML reports). It
 * coerces non-string input and escapes the five HTML-significant characters.
 */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
