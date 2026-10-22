import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EmptyTraces from './EmptyTraces.svelte';

describe('EmptyTraces', () => {
  it('renders the shared connect snippets with the OTLP platform selected', () => {
    render(EmptyTraces);
    expect(screen.getByRole('radiogroup', { name: 'Platform' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'OpenTelemetry OTLP' })).toBeChecked();
  });
});
