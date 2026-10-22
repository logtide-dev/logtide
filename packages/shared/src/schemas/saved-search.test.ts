import { describe, it, expect } from 'vitest';
import {
  savedSearchStateSchema,
  savedSearchCreateSchema,
  savedSearchUpdateSchema,
  SAVED_SEARCH_VISIBILITIES,
  SAVED_SEARCH_Q_MAX_LENGTH,
} from './saved-search.js';

const UUID_A = '6f1c2f9e-3d4b-4a8e-9f10-2b3c4d5e6f70';
const UUID_B = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('savedSearchStateSchema', () => {
  it('accepts a minimal state', () => {
    expect(savedSearchStateSchema.safeParse({ q: '', projectIds: [] }).success).toBe(true);
  });

  it('accepts a preset range', () => {
    const result = savedSearchStateSchema.safeParse({ q: 'level:error', projectIds: [UUID_A], range: '24h' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown range preset', () => {
    expect(savedSearchStateSchema.safeParse({ q: '', projectIds: [], range: '3y' }).success).toBe(false);
  });

  it('accepts a custom window', () => {
    const result = savedSearchStateSchema.safeParse({
      q: '',
      projectIds: [],
      from: '2026-10-21T10:00:00.000Z',
      to: '2026-10-21T11:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts view and columns', () => {
    const result = savedSearchStateSchema.safeParse({
      q: '',
      projectIds: [UUID_A, UUID_B],
      view: 'terminal',
      columns: ['region', 'user.id'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects range together with from/to', () => {
    const result = savedSearchStateSchema.safeParse({
      q: '',
      projectIds: [],
      range: '1h',
      from: '2026-10-21T10:00:00.000Z',
      to: '2026-10-21T11:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'range')).toBe(true);
    }
  });

  it('rejects from without to', () => {
    const result = savedSearchStateSchema.safeParse({ q: '', projectIds: [], from: '2026-10-21T10:00:00.000Z' });
    expect(result.success).toBe(false);
  });

  it('rejects to without from', () => {
    const result = savedSearchStateSchema.safeParse({ q: '', projectIds: [], to: '2026-10-21T10:00:00.000Z' });
    expect(result.success).toBe(false);
  });

  it('rejects from after to', () => {
    const result = savedSearchStateSchema.safeParse({
      q: '',
      projectIds: [],
      from: '2026-10-21T12:00:00.000Z',
      to: '2026-10-21T11:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects from equal to to', () => {
    const result = savedSearchStateSchema.safeParse({
      q: '',
      projectIds: [],
      from: '2026-10-21T11:00:00.000Z',
      to: '2026-10-21T11:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non ISO datetime', () => {
    const result = savedSearchStateSchema.safeParse({ q: '', projectIds: [], from: 'yesterday', to: 'today' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(savedSearchStateSchema.safeParse({ q: '', projectIds: [], foo: 1 }).success).toBe(false);
  });

  it('rejects an unknown view', () => {
    expect(savedSearchStateSchema.safeParse({ q: '', projectIds: [], view: 'grid' }).success).toBe(false);
  });

  it('rejects q longer than 2000 chars', () => {
    expect(SAVED_SEARCH_Q_MAX_LENGTH).toBe(2000);
    expect(savedSearchStateSchema.safeParse({ q: 'a'.repeat(2000), projectIds: [] }).success).toBe(true);
    expect(savedSearchStateSchema.safeParse({ q: 'a'.repeat(2001), projectIds: [] }).success).toBe(false);
  });

  it('rejects non-uuid and more than 100 project ids', () => {
    expect(savedSearchStateSchema.safeParse({ q: '', projectIds: ['not-a-uuid'] }).success).toBe(false);
    const many = Array.from({ length: 101 }, () => UUID_A);
    expect(savedSearchStateSchema.safeParse({ q: '', projectIds: many }).success).toBe(false);
    expect(savedSearchStateSchema.safeParse({ q: '', projectIds: many.slice(0, 100) }).success).toBe(true);
  });

  it('rejects more than 20 columns', () => {
    const columns = Array.from({ length: 21 }, (_, i) => `col${i}`);
    expect(savedSearchStateSchema.safeParse({ q: '', projectIds: [], columns }).success).toBe(false);
    expect(savedSearchStateSchema.safeParse({ q: '', projectIds: [], columns: columns.slice(0, 20) }).success).toBe(true);
  });

  it('rejects empty or overlong column names', () => {
    expect(savedSearchStateSchema.safeParse({ q: '', projectIds: [], columns: [''] }).success).toBe(false);
    expect(savedSearchStateSchema.safeParse({ q: '', projectIds: [], columns: ['c'.repeat(201)] }).success).toBe(false);
  });
});

describe('savedSearchCreateSchema', () => {
  it('trims the name and defaults visibility to private', () => {
    const result = savedSearchCreateSchema.safeParse({
      organizationId: UUID_A,
      name: '  Prod errors ',
      state: { q: 'level:error', projectIds: [] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Prod errors');
      expect(result.data.visibility).toBe('private');
    }
  });

  it('accepts organization visibility', () => {
    expect(SAVED_SEARCH_VISIBILITIES).toEqual(['private', 'organization']);
    const result = savedSearchCreateSchema.safeParse({
      organizationId: UUID_A,
      name: 'Shared',
      visibility: 'organization',
      state: { q: '', projectIds: [] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty name', () => {
    const blank = savedSearchCreateSchema.safeParse({ organizationId: UUID_A, name: '   ', state: { q: '', projectIds: [] } });
    expect(blank.success).toBe(false);
    const empty = savedSearchCreateSchema.safeParse({ organizationId: UUID_A, name: '', state: { q: '', projectIds: [] } });
    expect(empty.success).toBe(false);
  });

  it('rejects a name longer than 200 chars', () => {
    const result = savedSearchCreateSchema.safeParse({
      organizationId: UUID_A,
      name: 'n'.repeat(201),
      state: { q: '', projectIds: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown visibility and a non-uuid organization', () => {
    expect(
      savedSearchCreateSchema.safeParse({ organizationId: UUID_A, name: 'x', visibility: 'public', state: { q: '', projectIds: [] } }).success,
    ).toBe(false);
    expect(
      savedSearchCreateSchema.safeParse({ organizationId: 'org', name: 'x', state: { q: '', projectIds: [] } }).success,
    ).toBe(false);
  });
});

describe('savedSearchUpdateSchema', () => {
  it('rejects an empty patch', () => {
    expect(savedSearchUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a partial patch and trims the name', () => {
    const result = savedSearchUpdateSchema.safeParse({ name: ' Renamed ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Renamed');
      expect(result.data.visibility).toBeUndefined();
    }
    expect(savedSearchUpdateSchema.safeParse({ visibility: 'organization' }).success).toBe(true);
    expect(savedSearchUpdateSchema.safeParse({ state: { q: 'x', projectIds: [] } }).success).toBe(true);
  });

  it('validates the state like the create schema', () => {
    expect(savedSearchUpdateSchema.safeParse({ state: { q: '', projectIds: [], foo: 1 } }).success).toBe(false);
  });
});
