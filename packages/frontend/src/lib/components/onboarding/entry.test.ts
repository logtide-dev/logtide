import { describe, it, expect } from 'vitest';
import { decideEntry, type EntryInput } from './entry';

const base: EntryInput = {
  emailVerificationRequired: false,
  emailVerified: undefined,
  organizationCount: 0,
  server: { step: null, organizationId: null, projectId: null, completed: false, skipped: false },
};

function input(over: Partial<EntryInput> & { server?: Partial<EntryInput['server']> } = {}): EntryInput {
  return { ...base, ...over, server: { ...base.server, ...(over.server ?? {}) } };
}

describe('decideEntry', () => {
  it('redirects when onboarding is completed', () => {
    expect(decideEntry(input({ server: { completed: true } }))).toEqual({ kind: 'redirect', to: '/dashboard' });
  });

  it('redirects when onboarding was skipped', () => {
    expect(decideEntry(input({ server: { skipped: true } }))).toEqual({ kind: 'redirect', to: '/dashboard' });
  });

  it('goes to verify-email when required and unverified, keeping stored ids', () => {
    const d = decideEntry(
      input({
        emailVerificationRequired: true,
        emailVerified: false,
        server: { organizationId: 'o1', projectId: 'p1' },
      })
    );
    expect(d).toEqual({ kind: 'step', step: 'verify-email', organizationId: 'o1', projectId: 'p1' });
  });

  it('falls through when required but already verified', () => {
    const d = decideEntry(input({ emailVerificationRequired: true, emailVerified: true }));
    expect(d).toMatchObject({ kind: 'step', step: 'workspace' });
  });

  it('does not use verify-email when verification is not required', () => {
    const d = decideEntry(input({ emailVerificationRequired: false, emailVerified: false }));
    expect(d).toMatchObject({ kind: 'step', step: 'workspace' });
  });

  it('resumes at done when org and project are stored with step done', () => {
    const d = decideEntry(input({ server: { step: 'done', organizationId: 'o1', projectId: 'p1' } }));
    expect(d).toEqual({ kind: 'step', step: 'done', organizationId: 'o1', projectId: 'p1' });
  });

  it('resumes at connect when org and project are stored without a step', () => {
    const d = decideEntry(input({ server: { organizationId: 'o1', projectId: 'p1' } }));
    expect(d).toEqual({ kind: 'step', step: 'connect', organizationId: 'o1', projectId: 'p1' });
  });

  it('resumes at connect when the stored step is an earlier one', () => {
    const d = decideEntry(input({ server: { step: 'workspace', organizationId: 'o1', projectId: 'p1' } }));
    expect(d).toMatchObject({ step: 'connect' });
  });

  it('goes to workspace with the org id when only an org is stored, even with orgs', () => {
    const d = decideEntry(input({ organizationCount: 2, server: { organizationId: 'o1' } }));
    expect(d).toEqual({ kind: 'step', step: 'workspace', organizationId: 'o1', projectId: null });
  });

  it('redirects an invited user with orgs and no server state', () => {
    expect(decideEntry(input({ organizationCount: 2 }))).toEqual({ kind: 'redirect', to: '/dashboard' });
  });

  it('starts at workspace for a user without orgs', () => {
    expect(decideEntry(input())).toEqual({
      kind: 'step',
      step: 'workspace',
      organizationId: null,
      projectId: null,
    });
  });
});
