import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { onboardingService } from '../../../modules/onboarding/service.js';
import { createTestUser } from '../../helpers/factories.js';

describe('OnboardingService', () => {
    beforeEach(async () => {
        // Clean up in correct order (respecting foreign keys)
        await db.deleteFrom('user_onboarding').execute();
        await db.deleteFrom('logs').execute();
        await db.deleteFrom('alert_history').execute();
        await db.deleteFrom('sigma_rules').execute();
        await db.deleteFrom('alert_rules').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('notifications').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('users').execute();
    });

    describe('getOnboardingState', () => {
        it('should return default state for new user', async () => {
            const user = await createTestUser();

            const state = await onboardingService.getOnboardingState(user.id);

            expect(state).toEqual({
                checklistItems: {},
                checklistCollapsed: false,
                checklistDismissed: false,
                tutorialCompleted: false,
                tutorialStep: 0,
                tutorialSkipped: false,
                step: null,
                organizationId: null,
                projectId: null,
            });
        });

        it('should create record for new user', async () => {
            const user = await createTestUser();

            await onboardingService.getOnboardingState(user.id);

            // Verify record was created
            const record = await db
                .selectFrom('user_onboarding')
                .selectAll()
                .where('user_id', '=', user.id)
                .executeTakeFirst();

            expect(record).toBeDefined();
            expect(record?.user_id).toBe(user.id);
        });

        it('should return existing state if already exists', async () => {
            const user = await createTestUser();

            // Create initial state
            await db
                .insertInto('user_onboarding')
                .values({
                    user_id: user.id,
                    checklist_items: { step1: true },
                    checklist_collapsed: true,
                    checklist_dismissed: false,
                    tutorial_completed: true,
                    tutorial_step: 5,
                    tutorial_skipped: false,
                })
                .execute();

            const state = await onboardingService.getOnboardingState(user.id);

            expect(state.checklistItems).toEqual({ step1: true });
            expect(state.checklistCollapsed).toBe(true);
            expect(state.tutorialCompleted).toBe(true);
            expect(state.tutorialStep).toBe(5);
        });
    });

    describe('updateOnboardingState', () => {
        it('should update existing state', async () => {
            const user = await createTestUser();

            // First get to create record
            await onboardingService.getOnboardingState(user.id);

            // Update state
            const state = await onboardingService.updateOnboardingState(user.id, {
                tutorialStep: 3,
                checklistCollapsed: true,
            });

            expect(state.tutorialStep).toBe(3);
            expect(state.checklistCollapsed).toBe(true);
        });

        it('should create record if not exists (upsert)', async () => {
            const user = await createTestUser();

            // Directly update without getting first
            const state = await onboardingService.updateOnboardingState(user.id, {
                tutorialCompleted: true,
            });

            expect(state.tutorialCompleted).toBe(true);
        });

        it('should update checklistItems', async () => {
            const user = await createTestUser();

            await onboardingService.getOnboardingState(user.id);

            const state = await onboardingService.updateOnboardingState(user.id, {
                checklistItems: { step1: true, step2: true },
            });

            expect(state.checklistItems).toEqual({ step1: true, step2: true });
        });

        it('should update checklistDismissed', async () => {
            const user = await createTestUser();

            await onboardingService.getOnboardingState(user.id);

            const state = await onboardingService.updateOnboardingState(user.id, {
                checklistDismissed: true,
            });

            expect(state.checklistDismissed).toBe(true);
        });

        it('should update tutorialSkipped', async () => {
            const user = await createTestUser();

            await onboardingService.getOnboardingState(user.id);

            const state = await onboardingService.updateOnboardingState(user.id, {
                tutorialSkipped: true,
            });

            expect(state.tutorialSkipped).toBe(true);
        });

        it('should handle partial updates', async () => {
            const user = await createTestUser();

            // Create initial state with some values
            await onboardingService.updateOnboardingState(user.id, {
                tutorialStep: 2,
                checklistCollapsed: true,
            });

            // Update only one field
            const state = await onboardingService.updateOnboardingState(user.id, {
                tutorialStep: 5,
            });

            expect(state.tutorialStep).toBe(5);
            expect(state.checklistCollapsed).toBe(true); // Should preserve
        });
    });

    describe('completeChecklistItem', () => {
        it('should mark a checklist item as completed', async () => {
            const user = await createTestUser();

            const state = await onboardingService.completeChecklistItem(user.id, 'create_project');

            expect(state.checklistItems.create_project).toBe(true);
        });

        it('should preserve existing completed items', async () => {
            const user = await createTestUser();

            // Complete first item
            await onboardingService.completeChecklistItem(user.id, 'create_project');

            // Complete second item
            const state = await onboardingService.completeChecklistItem(user.id, 'create_api_key');

            expect(state.checklistItems.create_project).toBe(true);
            expect(state.checklistItems.create_api_key).toBe(true);
        });

        it('should handle re-completing same item', async () => {
            const user = await createTestUser();

            await onboardingService.completeChecklistItem(user.id, 'create_project');
            const state = await onboardingService.completeChecklistItem(user.id, 'create_project');

            expect(state.checklistItems.create_project).toBe(true);
        });
    });

    describe('resetOnboardingState', () => {
        it('should reset state to defaults', async () => {
            const user = await createTestUser();

            // Set up some state
            await onboardingService.updateOnboardingState(user.id, {
                tutorialStep: 5,
                tutorialCompleted: true,
                checklistItems: { step1: true, step2: true },
                checklistDismissed: true,
            });

            // Reset
            const state = await onboardingService.resetOnboardingState(user.id);

            expect(state).toEqual({
                checklistItems: {},
                checklistCollapsed: false,
                checklistDismissed: false,
                tutorialCompleted: false,
                tutorialStep: 0,
                tutorialSkipped: false,
                step: null,
                organizationId: null,
                projectId: null,
            });
        });

        it('should delete existing record', async () => {
            const user = await createTestUser();

            // Create state
            await onboardingService.getOnboardingState(user.id);

            // Verify record exists
            let record = await db
                .selectFrom('user_onboarding')
                .select('id')
                .where('user_id', '=', user.id)
                .executeTakeFirst();
            expect(record).toBeDefined();

            const originalId = record?.id;

            // Reset
            await onboardingService.resetOnboardingState(user.id);

            // Verify new record was created with different ID
            record = await db
                .selectFrom('user_onboarding')
                .select('id')
                .where('user_id', '=', user.id)
                .executeTakeFirst();
            expect(record).toBeDefined();
            expect(record?.id).not.toBe(originalId);
        });

        it('should work even if no state exists', async () => {
            const user = await createTestUser();

            // Reset without any prior state
            const state = await onboardingService.resetOnboardingState(user.id);

            expect(state).toEqual({
                checklistItems: {},
                checklistCollapsed: false,
                checklistDismissed: false,
                tutorialCompleted: false,
                tutorialStep: 0,
                tutorialSkipped: false,
                step: null,
                organizationId: null,
                projectId: null,
            });
        });
    });
});
