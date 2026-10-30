import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import DangerZone from './DangerZone.svelte';

describe('DangerZone', () => {
  it('shows the heading and children', () => {
    render(DangerZone, {
      children: createRawSnippet(() => ({ render: () => '<button>Delete organization</button>' })),
    });
    expect(screen.getByRole('region', { name: 'Danger zone' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete organization' })).toBeInTheDocument();
  });
});
