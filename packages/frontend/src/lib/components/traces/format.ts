/**
 * Human duration: `<1ms`, `123ms`, `1.23s`, `1.5m`. Rounds, never prints raw
 * floats; non-finite or negative input reads as `<1ms`.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1) return '<1ms';
  const rounded = Math.round(ms);
  if (rounded < 1000) return `${rounded}ms`;
  if (ms < 60000) {
    const seconds = Math.round((ms / 1000) * 100) / 100;
    if (seconds >= 60) return '1m';
    return `${seconds}s`;
  }
  const minutes = Math.round((ms / 60000) * 10) / 10;
  return `${minutes}m`;
}
