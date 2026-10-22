import type { OnboardingStep } from '$lib/api/onboarding';

export interface EntryInput {
  emailVerificationRequired: boolean;
  emailVerified: boolean | undefined;
  organizationCount: number;
  server: {
    step: OnboardingStep | null;
    organizationId: string | null;
    projectId: string | null;
    completed: boolean;
    skipped: boolean;
  };
}

export type EntryDecision =
  | { kind: 'redirect'; to: '/dashboard' }
  | {
      kind: 'step';
      step: OnboardingStep;
      organizationId: string | null;
      projectId: string | null;
    };

/**
 * Decide where the onboarding page should go on entry. Pure: all inputs come
 * from the server state, the auth config, the current user and the org list.
 */
export function decideEntry(input: EntryInput): EntryDecision {
  const { server } = input;
  const ids = { organizationId: server.organizationId, projectId: server.projectId };

  if (server.completed || server.skipped) {
    if (input.organizationCount > 0) {
      return { kind: 'redirect', to: '/dashboard' };
    }
    // Finished (or skipped) before, but the user has no organization any more
    // (deleted or removed): RequireOrganization sends them here, so offer the
    // workspace step instead of bouncing back to /dashboard forever.
    return { kind: 'step', step: 'workspace', organizationId: null, projectId: null };
  }

  if (input.emailVerificationRequired && input.emailVerified === false) {
    return { kind: 'step', step: 'verify-email', ...ids };
  }

  if (server.organizationId && server.projectId) {
    const step = server.step === 'done' ? 'done' : 'connect';
    return { kind: 'step', step, ...ids };
  }

  if (server.organizationId) {
    return { kind: 'step', step: 'workspace', organizationId: server.organizationId, projectId: null };
  }

  // Invited users and people who joined an existing org need no workspace.
  if (input.organizationCount > 0) {
    return { kind: 'redirect', to: '/dashboard' };
  }

  return { kind: 'step', step: 'workspace', organizationId: null, projectId: null };
}
