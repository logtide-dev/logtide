import { db } from '../../database/connection.js';
import type { ChecklistItemsState } from '../../database/types.js';

export const ONBOARDING_STEPS = ['verify-email', 'workspace', 'connect', 'done'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  checklistItems: ChecklistItemsState;
  checklistCollapsed: boolean;
  checklistDismissed: boolean;
  tutorialCompleted: boolean;
  tutorialStep: number;
  tutorialSkipped: boolean;
  /** Resume position of the 1.6 onboarding flow */
  step: OnboardingStep | null;
  organizationId: string | null;
  projectId: string | null;
}

/** The organization or project sent for storage is not reachable by the user. */
export class OnboardingScopeError extends Error {
  constructor() {
    super('Organization or project not found');
    this.name = 'OnboardingScopeError';
  }
}

const DEFAULT_STATE: OnboardingState = {
  checklistItems: {},
  checklistCollapsed: false,
  checklistDismissed: false,
  tutorialCompleted: false,
  tutorialStep: 0,
  tutorialSkipped: false,
  step: null,
  organizationId: null,
  projectId: null,
};

const STATE_COLUMNS = [
  'checklist_items',
  'checklist_collapsed',
  'checklist_dismissed',
  'tutorial_completed',
  'tutorial_step',
  'tutorial_skipped',
  'onboarding_step',
  'organization_id',
  'project_id',
] as const;

function asStep(value: string | null): OnboardingStep | null {
  return (ONBOARDING_STEPS as readonly string[]).includes(value ?? '') ? (value as OnboardingStep) : null;
}

class OnboardingService {
  private async isMember(userId: string, organizationId: string): Promise<boolean> {
    const row = await db
      .selectFrom('organization_members')
      .select('id')
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return !!row;
  }

  private async projectInOrganization(projectId: string, organizationId: string): Promise<boolean> {
    const row = await db
      .selectFrom('projects')
      .select('id')
      .where('id', '=', projectId)
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return !!row;
  }

  private async fetchRow(userId: string) {
    return db
      .selectFrom('user_onboarding')
      .select([...STATE_COLUMNS])
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  /**
   * Map a stored row to the API shape. Self-healing: a stored organization the
   * user no longer belongs to, or a stored project that is gone, soft-deleted
   * or outside that organization, comes back as null instead of an error.
   */
  private async toState(userId: string, row: NonNullable<Awaited<ReturnType<OnboardingService['fetchRow']>>>): Promise<OnboardingState> {
    let organizationId = row.organization_id;
    let projectId = row.project_id;

    if (organizationId && !(await this.isMember(userId, organizationId))) {
      organizationId = null;
    }
    if (projectId && (!organizationId || !(await this.projectInOrganization(projectId, organizationId)))) {
      projectId = null;
    }

    return {
      checklistItems: row.checklist_items,
      checklistCollapsed: row.checklist_collapsed,
      checklistDismissed: row.checklist_dismissed,
      tutorialCompleted: row.tutorial_completed,
      tutorialStep: row.tutorial_step,
      tutorialSkipped: row.tutorial_skipped,
      step: asStep(row.onboarding_step),
      organizationId,
      projectId,
    };
  }

  /**
   * Get onboarding state for a user
   * Creates a new record if one doesn't exist
   */
  async getOnboardingState(userId: string): Promise<OnboardingState> {
    const existing = await this.fetchRow(userId);
    if (existing) return this.toState(userId, existing);

    // Create new record with defaults (onConflict handles race conditions)
    await db
      .insertInto('user_onboarding')
      .values({
        user_id: userId,
        checklist_items: {},
        checklist_collapsed: false,
        checklist_dismissed: false,
        tutorial_completed: false,
        tutorial_step: 0,
        tutorial_skipped: false,
      })
      .onConflict((oc) => oc.column('user_id').doNothing())
      .execute();

    // Re-fetch in case of conflict (another request created it first)
    const created = await this.fetchRow(userId);
    if (created) return this.toState(userId, created);

    return DEFAULT_STATE;
  }

  /**
   * Update onboarding state for a user.
   * Throws OnboardingScopeError (nothing is stored) when the organization is not
   * one the user belongs to, or the project is not a live project of the
   * effective organization (the new value, else the stored one).
   */
  async updateOnboardingState(
    userId: string,
    updates: Partial<OnboardingState>
  ): Promise<OnboardingState> {
    const stored = await this.fetchRow(userId);

    // Validate the resume ids before writing anything.
    let effectiveOrg: string | null = stored?.organization_id ?? null;
    let clearProject = false;
    if (updates.organizationId !== undefined) {
      if (updates.organizationId !== null && !(await this.isMember(userId, updates.organizationId))) {
        throw new OnboardingScopeError();
      }
      if (updates.organizationId !== effectiveOrg && updates.projectId === undefined) {
        // The stored project belongs to the previous organization.
        clearProject = true;
      }
      effectiveOrg = updates.organizationId;
    }
    if (updates.projectId !== undefined && updates.projectId !== null) {
      if (!effectiveOrg || !(await this.projectInOrganization(updates.projectId, effectiveOrg))) {
        throw new OnboardingScopeError();
      }
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (updates.checklistItems !== undefined) {
      updateData.checklist_items = updates.checklistItems;
    }
    if (updates.checklistCollapsed !== undefined) {
      updateData.checklist_collapsed = updates.checklistCollapsed;
    }
    if (updates.checklistDismissed !== undefined) {
      updateData.checklist_dismissed = updates.checklistDismissed;
    }
    if (updates.tutorialCompleted !== undefined) {
      updateData.tutorial_completed = updates.tutorialCompleted;
    }
    if (updates.tutorialStep !== undefined) {
      updateData.tutorial_step = updates.tutorialStep;
    }
    if (updates.tutorialSkipped !== undefined) {
      updateData.tutorial_skipped = updates.tutorialSkipped;
    }
    if (updates.step !== undefined) {
      updateData.onboarding_step = updates.step;
      // Keep older readers coherent: tutorial_step mirrors the step index.
      if (updates.step !== null && updates.tutorialStep === undefined) {
        updateData.tutorial_step = ONBOARDING_STEPS.indexOf(updates.step);
      }
    }
    if (updates.organizationId !== undefined) {
      updateData.organization_id = updates.organizationId;
    }
    if (updates.projectId !== undefined) {
      updateData.project_id = updates.projectId;
    } else if (clearProject) {
      updateData.project_id = null;
    }

    if (stored) {
      await db
        .updateTable('user_onboarding')
        .set(updateData)
        .where('user_id', '=', userId)
        .execute();
    } else {
      await db
        .insertInto('user_onboarding')
        .values({
          user_id: userId,
          checklist_items: updates.checklistItems ?? {},
          checklist_collapsed: updates.checklistCollapsed ?? false,
          checklist_dismissed: updates.checklistDismissed ?? false,
          tutorial_completed: updates.tutorialCompleted ?? false,
          tutorial_step:
            (updateData.tutorial_step as number | undefined) ?? updates.tutorialStep ?? 0,
          tutorial_skipped: updates.tutorialSkipped ?? false,
          onboarding_step: updates.step ?? null,
          organization_id: updates.organizationId ?? null,
          project_id: updates.projectId ?? null,
        })
        .onConflict((oc) => oc.column('user_id').doUpdateSet(updateData))
        .execute();
    }

    return this.getOnboardingState(userId);
  }

  /**
   * Mark a checklist item as completed
   */
  async completeChecklistItem(userId: string, itemId: string): Promise<OnboardingState> {
    const currentState = await this.getOnboardingState(userId);
    const newItems = { ...currentState.checklistItems, [itemId]: true };

    return this.updateOnboardingState(userId, { checklistItems: newItems });
  }

  /**
   * Reset onboarding state for a user (also clears step, organization and project)
   */
  async resetOnboardingState(userId: string): Promise<OnboardingState> {
    await db
      .deleteFrom('user_onboarding')
      .where('user_id', '=', userId)
      .execute();

    return this.getOnboardingState(userId);
  }
}

export const onboardingService = new OnboardingService();
