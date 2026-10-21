import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import PageHeader from './PageHeader.svelte';

const snip = (html: string) => createRawSnippet(() => ({ render: () => html }));

describe('PageHeader', () => {
  it('renders exactly one level 1 heading with the title', () => {
    render(PageHeader, { title: 'Alert rules' });
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0].textContent).toBe('Alert rules');
  });

  it('shows the applies-to chip', () => {
    render(PageHeader, { title: 'T', appliesTo: 'organization' });
    expect(screen.getByText('Applies to: Organization')).toBeInTheDocument();
  });

  it('shows no chip when appliesTo is absent', () => {
    render(PageHeader, { title: 'T' });
    expect(screen.queryByText(/Applies to/)).toBeNull();
  });

  it('renders the description', () => {
    render(PageHeader, { title: 'T', description: 'Some help text' });
    expect(screen.getByText('Some help text')).toBeInTheDocument();
  });

  it('renders breadcrumbs with links and a current page marker', () => {
    render(PageHeader, {
      title: 'T',
      breadcrumbs: [
        { label: 'Settings', href: '/dashboard/settings' },
        { label: 'Members' },
      ],
    });
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Settings' });
    expect(link.getAttribute('href')).toBe('/dashboard/settings');
    expect(screen.getByText('Members').getAttribute('aria-current')).toBe('page');
  });

  it('renders the actions and meta snippets', () => {
    render(PageHeader, {
      title: 'T',
      actions: snip('<button>Create rule</button>'),
      meta: snip('<span>3 rules</span>'),
    });
    expect(screen.getByRole('button', { name: 'Create rule' })).toBeInTheDocument();
    expect(screen.getByText('3 rules')).toBeInTheDocument();
  });
});
