import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import SettingsSection from './SettingsSection.svelte';

describe('SettingsSection', () => {
  it('links the section to its heading and renders children', () => {
    render(SettingsSection, {
      title: 'Retention',
      description: 'How long logs are kept',
      children: createRawSnippet(() => ({ render: () => '<p>Body content</p>' })),
    });
    const section = screen.getByRole('region', { name: 'Retention' });
    const heading = screen.getByRole('heading', { level: 2, name: 'Retention' });
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(screen.getByText('How long logs are kept')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('gives two sections distinct heading ids', () => {
    render(SettingsSection, { title: 'One' });
    render(SettingsSection, { title: 'Two' });
    const a = screen.getByRole('heading', { name: 'One' }).id;
    const b = screen.getByRole('heading', { name: 'Two' }).id;
    expect(a).not.toBe(b);
  });
});
