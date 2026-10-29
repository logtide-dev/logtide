import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EmptyMetrics from './EmptyMetrics.svelte';

describe('EmptyMetrics', () => {
  it('renders the shared connect snippets with the OTLP platform selected', () => {
    render(EmptyMetrics);
    expect(screen.getByRole('radiogroup', { name: 'Platform' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'OpenTelemetry OTLP' })).toBeChecked();
    expect(document.body.textContent).toContain('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT');
  });

  it('no longer carries the hand-built language tabs', () => {
    render(EmptyMetrics);
    expect(document.body.textContent).not.toContain('PeriodicExportingMetricReader');
    expect(screen.queryByRole('tab', { name: 'Node.js' })).toBeNull();
  });
});
