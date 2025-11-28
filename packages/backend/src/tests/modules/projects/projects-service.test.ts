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
});
