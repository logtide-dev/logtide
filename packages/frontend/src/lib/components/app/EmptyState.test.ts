import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Rocket from '@lucide/svelte/icons/rocket';
import EmptyState from './EmptyState.svelte';

const variants = ['no-data', 'no-results', 'error', 'setup'] as const;

describe('EmptyState', () => {
  for (const variant of variants) {
    it(`renders title and description for ${variant}`, () => {
      render(EmptyState, { variant, title: `Title ${variant}`, description: `Desc ${variant}` });
      expect(screen.getByText(`Title ${variant}`)).toBeInTheDocument();
      expect(screen.getByText(`Desc ${variant}`)).toBeInTheDocument();
    });
  }

  it('uses role alert for error', () => {
    render(EmptyState, { variant: 'error', title: 'Failed' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('uses role status for the other variants', () => {
    for (const variant of ['no-data', 'no-results', 'setup'] as const) {
      const { unmount } = render(EmptyState, { variant, title: 'x' });
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
      unmount();
    }
  });

  it('renders the actions snippet', () => {
    render(EmptyState, {
      variant: 'no-data',
      title: 'x',
      actions: createRawSnippet(() => ({ render: () => '<button>Add one</button>' })),
    });
    expect(screen.getByRole('button', { name: 'Add one' })).toBeInTheDocument();
  });

  it('uses the default icon of the variant and lets a custom icon win', () => {
    const a = render(EmptyState, { variant: 'no-data', title: 'x' });
    const defaultSvg = a.container.querySelector('svg')!;
    expect(defaultSvg.getAttribute('class')).toContain('lucide-inbox');
    a.unmount();
    const b = render(EmptyState, { variant: 'no-data', title: 'x', icon: Rocket as never });
    expect(b.container.querySelector('svg')!.getAttribute('class')).toContain('lucide-rocket');
  });

  it('colours the error icon with the destructive text token', () => {
    const { container } = render(EmptyState, { variant: 'error', title: 'x' });
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('text-destructive-text');
  });
});
