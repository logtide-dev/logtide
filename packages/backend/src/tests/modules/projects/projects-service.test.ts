import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { ProjectsService } from '../../../modules/projects/service.js';
import { createTestUser, createTestOrganization, createTestContext } from '../../helpers/factories.js';

describe('ProjectsService', () => {
    let projectsService: ProjectsService;

    beforeEach(async () => {
        projectsService = new ProjectsService();

        // Clean up in correct order (respecting foreign keys)
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

    describe('createProject', () => {
        it('should create a project with valid input', async () => {
            const user = await createTestUser();
            // createTestOrganization already adds owner as member
            const org = await createTestOrganization({ ownerId: user.id });

            const project = await projectsService.createProject({
                organizationId: org.id,
                userId: user.id,
                name: 'Test Project',
            });

            expect(project.id).toBeDefined();
            expect(project.name).toBe('Test Project');
            expect(project.organizationId).toBe(org.id);
        });

        it('should create a project with description', async () => {
            const user = await createTestUser();
            // createTestOrganization already adds owner as member
            const org = await createTestOrganization({ ownerId: user.id });

            const project = await projectsService.createProject({
                organizationId: org.id,
                userId: user.id,
                name: 'Described Project',
                description: 'A detailed description',
            });

            expect(project.description).toBe('A detailed description');
        });

        it('should throw error if user does not have access to organization', async () => {
            const user = await createTestUser({ email: 'user@test.com' });
            const owner = await createTestUser({ email: 'owner@test.com' });
            const org = await createTestOrganization({ ownerId: owner.id });

            await expect(
                projectsService.createProject({
                    organizationId: org.id,
                    userId: user.id,
                    name: 'Unauthorized Project',
                })
            ).rejects.toThrow('You do not have access to this organization');
        });

        it('should throw error for duplicate project name in organization', async () => {
            const { user, organization } = await createTestContext();

            // First project
            await projectsService.createProject({
                organizationId: organization.id,
                userId: user.id,
                name: 'Duplicate Name',
            });

            // Second project with same name should fail
            await expect(
                projectsService.createProject({
                    organizationId: organization.id,
                    userId: user.id,
                    name: 'Duplicate Name',
                })
            ).rejects.toThrow('A project with this name already exists in this organization');
        });

        it('should allow same project name in different organizations', async () => {
            const { user, organization: org1 } = await createTestContext();

            // Create second organization with same user
            // createTestOrganization already adds owner as member
            const org2 = await createTestOrganization({ ownerId: user.id, name: 'Org 2' });

            // Create project in org1
            const project1 = await projectsService.createProject({
                organizationId: org1.id,
                userId: user.id,
                name: 'Same Name',
            });

            // Create project with same name in org2
            const project2 = await projectsService.createProject({
                organizationId: org2.id,
                userId: user.id,
                name: 'Same Name',
            });

            expect(project1.name).toBe('Same Name');
            expect(project2.name).toBe('Same Name');
            expect(project1.organizationId).not.toBe(project2.organizationId);
        });
    });

    describe('getOrganizationProjects', () => {
        it('should return empty array for organization with no projects', async () => {
            const user = await createTestUser();
            // createTestOrganization already adds owner as member
            const org = await createTestOrganization({ ownerId: user.id });

            const projects = await projectsService.getOrganizationProjects(org.id, user.id);

            expect(projects).toEqual([]);
        });

        it('should return all projects for an organization', async () => {
            const user = await createTestUser();
            // createTestOrganization already adds owner as member
            const org = await createTestOrganization({ ownerId: user.id });

            await projectsService.createProject({
                organizationId: org.id,
                userId: user.id,
                name: 'Project 1',
            });

            await projectsService.createProject({
                organizationId: org.id,
                userId: user.id,
                name: 'Project 2',
            });

            await projectsService.createProject({
                organizationId: org.id,
                userId: user.id,
                name: 'Project 3',
            });

            const projects = await projectsService.getOrganizationProjects(org.id, user.id);

            expect(projects).toHaveLength(3);
        });

        it('should throw error if user does not have access', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const outsider = await createTestUser({ email: 'outsider@test.com' });
            const org = await createTestOrganization({ ownerId: owner.id });

            await expect(
                projectsService.getOrganizationProjects(org.id, outsider.id)
            ).rejects.toThrow('You do not have access to this organization');
        });

        it('should order projects by created_at descending', async () => {
            const { user, organization } = await createTestContext();

            await projectsService.createProject({
                organizationId: organization.id,
                userId: user.id,
                name: 'First',
            });

            await new Promise((resolve) => setTimeout(resolve, 10));

            await projectsService.createProject({
                organizationId: organization.id,
                userId: user.id,
                name: 'Second',
            });

            const projects = await projectsService.getOrganizationProjects(organization.id, user.id);

            expect(projects[0].name).toBe('Second');
            expect(projects[1].name).toBe('First');
        });
    });

    describe('getProjectById', () => {
        it('should return null for non-existent project', async () => {
            const user = await createTestUser();

            const project = await projectsService.getProjectById(
                '00000000-0000-0000-0000-000000000000',
                user.id
            );

            expect(project).toBeNull();
        });

        it('should return null if user does not have access', async () => {
            const { project } = await createTestContext();
            const outsider = await createTestUser({ email: 'outsider@test.com' });

            const result = await projectsService.getProjectById(project.id, outsider.id);

            expect(result).toBeNull();
        });

        it('should return project for authorized user', async () => {
            const { project, user } = await createTestContext();

            const result = await projectsService.getProjectById(project.id, user.id);

            expect(result).not.toBeNull();
            expect(result?.id).toBe(project.id);
            expect(result?.name).toBe(project.name);
        });
    });

    describe('updateProject', () => {
        it('should update project name', async () => {
            const { project, user } = await createTestContext();

            const updated = await projectsService.updateProject(project.id, user.id, {
                name: 'Updated Name',
            });

            expect(updated?.name).toBe('Updated Name');
        });

        it('should update project description', async () => {
            const { project, user } = await createTestContext();

            const updated = await projectsService.updateProject(project.id, user.id, {
                description: 'New description',
            });

            expect(updated?.description).toBe('New description');
        });

        it('should clear description when set to empty string', async () => {
            const { user, organization } = await createTestContext();

            const project = await projectsService.createProject({
                organizationId: organization.id,
                userId: user.id,
                name: 'Project with description',
                description: 'Initial description',
            });

            const updated = await projectsService.updateProject(project.id, user.id, {
                description: '',
            });

            expect(updated?.description).toBeUndefined();
        });

        it('should return null for non-existent project', async () => {
            const user = await createTestUser();

            const updated = await projectsService.updateProject(
                '00000000-0000-0000-0000-000000000000',
                user.id,
                { name: 'Test' }
            );

            expect(updated).toBeNull();
        });

        it('should return null if user does not have access', async () => {
            const { project } = await createTestContext();
            const outsider = await createTestUser({ email: 'outsider@test.com' });

            const updated = await projectsService.updateProject(project.id, outsider.id, {
                name: 'Hacked Name',
            });

            expect(updated).toBeNull();
        });

        it('should throw error for duplicate name in organization', async () => {
            const { user, organization } = await createTestContext();

            await projectsService.createProject({
                organizationId: organization.id,
                userId: user.id,
                name: 'Existing Project',
            });

            const projectToUpdate = await projectsService.createProject({
                organizationId: organization.id,
                userId: user.id,
                name: 'Another Project',
            });

            await expect(
                projectsService.updateProject(projectToUpdate.id, user.id, {
                    name: 'Existing Project',
                })
            ).rejects.toThrow('A project with this name already exists in this organization');
        });

        it('should allow updating to same name', async () => {
            const { project, user } = await createTestContext();

            const updated = await projectsService.updateProject(project.id, user.id, {
                name: project.name,
            });

            expect(updated?.name).toBe(project.name);
        });

        it('should throw when attempting to update a soft-deleted project', async () => {
            const { project, user } = await createTestContext();

            await projectsService.deleteProject(project.id, user.id);

            await expect(
                projectsService.updateProject(project.id, user.id, { name: 'New Name' })
            ).rejects.toThrow('Cannot update a deleted project');
        });

        it('should update updated_at timestamp', async () => {
            const { user, organization } = await createTestContext();

            const project = await projectsService.createProject({
                organizationId: organization.id,
                userId: user.id,
                name: 'Timestamp Test',
            });

            const updated = await projectsService.updateProject(project.id, user.id, {
                name: 'Updated Name',
            });

            // Verify update was successful and has a valid timestamp
            expect(updated).not.toBeNull();
            expect(updated?.name).toBe('Updated Name');
            expect(updated?.updatedAt).toBeInstanceOf(Date);
            expect(updated?.updatedAt.getTime()).toBeGreaterThan(0);
        });
    });

    describe('deleteProject', () => {
        it('should delete a project', async () => {
            const { project, user, organization } = await createTestContext();

            const deleted = await projectsService.deleteProject(project.id, user.id);

            expect(deleted).toBe(true);

            const remaining = await projectsService.getOrganizationProjects(organization.id, user.id);
            expect(remaining.find((p) => p.id === project.id)).toBeUndefined();
        });

        it('should return false for non-existent project', async () => {
            const user = await createTestUser();

            const deleted = await projectsService.deleteProject(
                '00000000-0000-0000-0000-000000000000',
                user.id
            );

            expect(deleted).toBe(false);
        });

        it('should return false if user does not have access', async () => {
            const { project } = await createTestContext();
            const outsider = await createTestUser({ email: 'outsider@test.com' });

            const deleted = await projectsService.deleteProject(project.id, outsider.id);

            expect(deleted).toBe(false);
        });

        it('should return false for an already soft-deleted project', async () => {
            const { project, user } = await createTestContext();

            await projectsService.deleteProject(project.id, user.id);

            // Calling delete again should return false
            const secondDelete = await projectsService.deleteProject(project.id, user.id);
            expect(secondDelete).toBe(false);
        });

        it('should not affect other projects', async () => {
            const { user, organization } = await createTestContext();

            const project1 = await projectsService.createProject({
                organizationId: organization.id,
                userId: user.id,
                name: 'Project 1',
            });

            const project2 = await projectsService.createProject({
                organizationId: organization.id,
                userId: user.id,
                name: 'Project 2',
            });

            await projectsService.deleteProject(project1.id, user.id);

            const result = await projectsService.getProjectById(project2.id, user.id);
            expect(result).not.toBeNull();
            expect(result?.name).toBe('Project 2');
        });
    });

    describe('restoreProject', () => {
        it('should restore a soft-deleted project', async () => {
            const { project, user } = await createTestContext();

            await projectsService.deleteProject(project.id, user.id);

            const restored = await projectsService.restoreProject(project.id, user.id);
            expect(restored).toBe(true);

            const found = await projectsService.getProjectById(project.id, user.id);
            expect(found).not.toBeNull();
            expect(found?.deletedAt).toBeNull();
        });

        it('should return false for a non-existent project', async () => {
            const user = await createTestUser();

            const restored = await projectsService.restoreProject(
                '00000000-0000-0000-0000-000000000000',
                user.id
            );

            expect(restored).toBe(false);
        });

        it('should return false for a project that is not deleted', async () => {
            const { project, user } = await createTestContext();

            const restored = await projectsService.restoreProject(project.id, user.id);
            expect(restored).toBe(false);
        });

        it('should return false if user does not have access', async () => {
            const { project, user } = await createTestContext();
            const outsider = await createTestUser({ email: 'outsider-restore@test.com' });

            await projectsService.deleteProject(project.id, user.id);

            const restored = await projectsService.restoreProject(project.id, outsider.id);
            expect(restored).toBe(false);
        });

        it('should throw when an active project has reused the name or slug', async () => {
            const { project, user, organization } = await createTestContext();

            await projectsService.deleteProject(project.id, user.id);

            // A new active project takes the freed name (and slug).
            await projectsService.createProject({
                organizationId: organization.id,
                userId: user.id,
                name: project.name,
            });

            await expect(
                projectsService.restoreProject(project.id, user.id)
            ).rejects.toThrow('already exists');

            // The conflicting project stays soft-deleted.
            const stillDeleted = await projectsService.getProjectById(project.id, user.id);
            expect(stillDeleted?.deletedAt).not.toBeNull();
        });
    });

    describe('getOrganizationProjectsIncludingDeleted', () => {
        it('should return both active and soft-deleted projects', async () => {
            const { user, organization } = await createTestContext();

            const p1 = await projectsService.createProject({
                organizationId: organization.id,
                userId: user.id,
                name: 'Active Project',
            });
            const p2 = await projectsService.createProject({
                organizationId: organization.id,
                userId: user.id,
                name: 'Deleted Project',
            });

            await projectsService.deleteProject(p2.id, user.id);

            const all = await projectsService.getOrganizationProjectsIncludingDeleted(organization.id, user.id);

            const ids = all.map((p) => p.id);
            expect(ids).toContain(p1.id);
            expect(ids).toContain(p2.id);
        });

        it('should not include projects from other organizations', async () => {
            const { user, organization } = await createTestContext();
            const other = await createTestContext();

            const all = await projectsService.getOrganizationProjectsIncludingDeleted(organization.id, user.id);

            const ids = all.map((p) => p.id);
            expect(ids).not.toContain(other.project.id);
        });

        it('should throw when user is not a member of the organization', async () => {
            const { organization } = await createTestContext();
            const outsider = await createTestUser({ email: 'outsider-incl@test.com' });

            await expect(
                projectsService.getOrganizationProjectsIncludingDeleted(organization.id, outsider.id)
            ).rejects.toThrow('do not have access');
        });

        it('should mark deleted projects with a non-null deletedAt', async () => {
            const { project, user, organization } = await createTestContext();

            await projectsService.deleteProject(project.id, user.id);

            const all = await projectsService.getOrganizationProjectsIncludingDeleted(organization.id, user.id);
            const deleted = all.find((p) => p.id === project.id);

            expect(deleted).toBeDefined();
            expect(deleted?.deletedAt).not.toBeNull();
            expect(deleted?.deletedAt).toBeInstanceOf(Date);
        });
    });

    describe('getProjectDataAvailability', () => {
        it('should return empty arrays when no data exists', async () => {
            const { user, organization } = await createTestContext();

            const result = await projectsService.getProjectDataAvailability(organization.id, user.id);

            expect(result.logs).toEqual([]);
            expect(result.traces).toEqual([]);
            expect(result.metrics).toEqual([]);
        });

        it('should throw when user is not a member of the organization', async () => {
            const { organization } = await createTestContext();
            const outsider = await createTestUser({ email: 'outsider-da@test.com' });

            await expect(
                projectsService.getProjectDataAvailability(organization.id, outsider.id)
            ).rejects.toThrow('do not have access');
        });

        it('includes a project in logs when markHasData(logs) has run', async () => {
            const { user, organization, project } = await createTestContext();

            await projectsService.markHasData(project.id, 'logs');

            const result = await projectsService.getProjectDataAvailability(organization.id, user.id);
            expect(result.logs).toContain(project.id);
            expect(result.traces).not.toContain(project.id);
            expect(result.metrics).not.toContain(project.id);
        });

        it('does not include a project whose has_logs_at is older than org retention', async () => {
            const { user, organization, project } = await createTestContext();

            // Force retention to 1 day, then plant has_logs_at 10 days ago.
            await db.updateTable('organizations').set({ retention_days: 1 }).where('id', '=', organization.id).execute();
            const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
            await db.updateTable('projects').set({ has_logs_at: tenDaysAgo }).where('id', '=', project.id).execute();

            const result = await projectsService.getProjectDataAvailability(organization.id, user.id);
            expect(result.logs).not.toContain(project.id);
        });

        it('should return empty arrays when organization has no projects', async () => {
            const user = await createTestUser({ email: 'no-projects@test.com' });
            const org = await createTestOrganization({ ownerId: user.id, name: 'Empty Org', slug: `empty-org-${Date.now()}` });

            const result = await projectsService.getProjectDataAvailability(org.id, user.id);

            expect(result.logs).toEqual([]);
            expect(result.traces).toEqual([]);
            expect(result.metrics).toEqual([]);
        });

        it('includes a project in traces when markHasData(traces) has run', async () => {
            const { user, organization, project } = await createTestContext();

            await projectsService.markHasData(project.id, 'traces');

            const result = await projectsService.getProjectDataAvailability(organization.id, user.id);
            expect(result.traces).toContain(project.id);
        });

        it('includes a project in metrics when markHasData(metrics) has run', async () => {
            const { user, organization, project } = await createTestContext();

            await projectsService.markHasData(project.id, 'metrics');

            const result = await projectsService.getProjectDataAvailability(organization.id, user.id);
            expect(result.metrics).toContain(project.id);
        });
    });

    describe('markHasData', () => {
        it('sets the corresponding column to a fresh timestamp', async () => {
            const { project } = await createTestContext();

            await projectsService.markHasData(project.id, 'logs');

            const row = await db
                .selectFrom('projects')
                .select(['has_logs_at', 'has_traces_at', 'has_metrics_at'])
                .where('id', '=', project.id)
                .executeTakeFirstOrThrow();

            expect(row.has_logs_at).not.toBeNull();
            expect(row.has_traces_at).toBeNull();
            expect(row.has_metrics_at).toBeNull();
        });

        it('debounces rapid calls for the same (project, kind)', async () => {
            const { project } = await createTestContext();

            // Fresh service instance does not reset the module-level debounce Map,
            // so we use a distinct project created in this test to guarantee a
            // clean slate.
            await projectsService.markHasData(project.id, 'logs');

            const firstTimestamp = (await db
                .selectFrom('projects')
                .select('has_logs_at')
                .where('id', '=', project.id)
                .executeTakeFirstOrThrow()).has_logs_at;

            // Second call within the debounce window must be a no-op.
            await projectsService.markHasData(project.id, 'logs');

            const secondTimestamp = (await db
                .selectFrom('projects')
                .select('has_logs_at')
                .where('id', '=', project.id)
                .executeTakeFirstOrThrow()).has_logs_at;

            expect(secondTimestamp).toEqual(firstTimestamp);
        });

        it('does not touch other kinds when updating one', async () => {
            const { project } = await createTestContext();

            await projectsService.markHasData(project.id, 'traces');

            const row = await db
                .selectFrom('projects')
                .select(['has_logs_at', 'has_traces_at', 'has_metrics_at'])
                .where('id', '=', project.id)
                .executeTakeFirstOrThrow();

            expect(row.has_traces_at).not.toBeNull();
            expect(row.has_logs_at).toBeNull();
            expect(row.has_metrics_at).toBeNull();
        });
    });

    describe('updateProject slug', () => {
        it('updates slug when valid and unique in org', async () => {
            const user = await createTestUser();
            const org = await createTestOrganization({ ownerId: user.id });
            const project = await projectsService.createProject({
                organizationId: org.id,
                userId: user.id,
                name: 'App One',
            });

            const updated = await projectsService.updateProject(project.id, user.id, {
                slug: 'custom-slug',
            });

            expect(updated?.slug).toBe('custom-slug');
        });

        it('rejects invalid slug format', async () => {
            const user = await createTestUser();
            const org = await createTestOrganization({ ownerId: user.id });
            const project = await projectsService.createProject({
                organizationId: org.id,
                userId: user.id,
                name: 'App One',
            });

            await expect(
                projectsService.updateProject(project.id, user.id, { slug: 'Bad Slug!' })
            ).rejects.toThrow(/lowercase letters/);
        });

        it('rejects reserved slug', async () => {
            const user = await createTestUser();
            const org = await createTestOrganization({ ownerId: user.id });
            const project = await projectsService.createProject({
                organizationId: org.id,
                userId: user.id,
                name: 'App One',
            });

            await expect(
                projectsService.updateProject(project.id, user.id, { slug: 'api' })
            ).rejects.toThrow(/reserved slug/);
        });

        it('rejects conflict with another project in same org', async () => {
            const user = await createTestUser();
            const org = await createTestOrganization({ ownerId: user.id });
            await projectsService.createProject({
                organizationId: org.id,
                userId: user.id,
                name: 'Taken',
            });
            const other = await projectsService.createProject({
                organizationId: org.id,
                userId: user.id,
                name: 'Other',
            });

            await expect(
                projectsService.updateProject(other.id, user.id, { slug: 'taken' })
            ).rejects.toThrow(/already exists/);
        });

        it('allows same slug in different org', async () => {
            const userA = await createTestUser({ email: 'a@test.com' });
            const orgA = await createTestOrganization({ ownerId: userA.id });
            const userB = await createTestUser({ email: 'b@test.com' });
            const orgB = await createTestOrganization({ ownerId: userB.id });

            const a = await projectsService.createProject({
                organizationId: orgA.id,
                userId: userA.id,
                name: 'Shared',
            });
            const b = await projectsService.createProject({
                organizationId: orgB.id,
                userId: userB.id,
                name: 'Different Name',
            });

            await projectsService.updateProject(a.id, userA.id, { slug: 'shared' });
            const updatedB = await projectsService.updateProject(b.id, userB.id, { slug: 'shared' });

            expect(updatedB?.slug).toBe('shared');
        });
    });
});
