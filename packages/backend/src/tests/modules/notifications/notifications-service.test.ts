import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { NotificationsService } from '../../../modules/notifications/service.js';
import { createTestUser, createTestContext } from '../../helpers/factories.js';

describe('NotificationsService', () => {
    let notificationsService: NotificationsService;

    beforeEach(async () => {
        notificationsService = new NotificationsService();

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

    describe('createNotification', () => {
        it('should create a notification with required fields', async () => {
            const user = await createTestUser();

            const notification = await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'Test Alert',
                message: 'This is a test notification',
            });

            expect(notification.id).toBeDefined();
            expect(notification.userId).toBe(user.id);
            expect(notification.type).toBe('alert');
            expect(notification.title).toBe('Test Alert');
            expect(notification.message).toBe('This is a test notification');
            expect(notification.read).toBe(false);
        });

        it('should create a notification with organization context', async () => {
            const { user, organization } = await createTestContext();

            const notification = await notificationsService.createNotification({
                userId: user.id,
                type: 'organization_invite',
                title: 'Org Invite',
                message: 'You have been invited',
                organizationId: organization.id,
            });

            expect(notification.organizationId).toBe(organization.id);
        });

        it('should create a notification with project context', async () => {
            const { user, project } = await createTestContext();

            const notification = await notificationsService.createNotification({
                userId: user.id,
                type: 'project_update',
                title: 'Project Update',
                message: 'Project was updated',
                projectId: project.id,
            });

            expect(notification.projectId).toBe(project.id);
        });

        it('should create a notification with metadata', async () => {
            const user = await createTestUser();
            const metadata = { alertRuleId: 'rule-123', severity: 'high' };

            const notification = await notificationsService.createNotification({
                userId: user.id,
                type: 'system',
                title: 'System Notice',
                message: 'System maintenance scheduled',
                metadata,
            });

            expect(notification.metadata).toEqual(metadata);
        });

        it('should create notifications of all types', async () => {
            const user = await createTestUser();
            const types = ['alert', 'system', 'organization_invite', 'project_update'] as const;

            for (const type of types) {
                const notification = await notificationsService.createNotification({
                    userId: user.id,
                    type,
                    title: `${type} notification`,
                    message: `Message for ${type}`,
                });

                expect(notification.type).toBe(type);
            }
        });
    });

    describe('getUserNotifications', () => {
        it('should return empty array for user with no notifications', async () => {
            const user = await createTestUser();

            const result = await notificationsService.getUserNotifications(user.id);

            expect(result.notifications).toEqual([]);
            expect(result.total).toBe(0);
            expect(result.unreadCount).toBe(0);
        });

        it('should return all notifications for a user', async () => {
            const user = await createTestUser();

            await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'Alert 1',
                message: 'Message 1',
            });

            await notificationsService.createNotification({
                userId: user.id,
                type: 'system',
                title: 'System 1',
                message: 'Message 2',
            });

            const result = await notificationsService.getUserNotifications(user.id);

            expect(result.notifications).toHaveLength(2);
            expect(result.total).toBe(2);
            expect(result.unreadCount).toBe(2);
        });

        it('should not return notifications from other users', async () => {
            const user1 = await createTestUser({ email: 'user1@test.com' });
            const user2 = await createTestUser({ email: 'user2@test.com' });

            await notificationsService.createNotification({
                userId: user1.id,
                type: 'alert',
                title: 'User 1 Alert',
                message: 'For user 1',
            });

            await notificationsService.createNotification({
                userId: user2.id,
                type: 'alert',
                title: 'User 2 Alert',
                message: 'For user 2',
            });

            const result = await notificationsService.getUserNotifications(user1.id);

            expect(result.notifications).toHaveLength(1);
            expect(result.notifications[0].title).toBe('User 1 Alert');
        });

        it('should filter unread only notifications', async () => {
            const user = await createTestUser();

            const n1 = await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'Unread',
                message: 'Unread message',
            });

            const n2 = await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'Read',
                message: 'Read message',
            });

            // Mark second notification as read
            await notificationsService.markAsRead(n2.id, user.id);

            const result = await notificationsService.getUserNotifications(user.id, {
                unreadOnly: true,
            });

            expect(result.notifications).toHaveLength(1);
            expect(result.notifications[0].title).toBe('Unread');
        });

        it('should respect limit parameter', async () => {
            const user = await createTestUser();

            for (let i = 0; i < 10; i++) {
                await notificationsService.createNotification({
                    userId: user.id,
                    type: 'alert',
                    title: `Alert ${i}`,
                    message: `Message ${i}`,
                });
            }

            const result = await notificationsService.getUserNotifications(user.id, {
                limit: 5,
            });

            expect(result.notifications).toHaveLength(5);
            expect(result.total).toBe(10);
        });

        it('should respect offset parameter', async () => {
            const user = await createTestUser();

            for (let i = 0; i < 5; i++) {
                await notificationsService.createNotification({
                    userId: user.id,
                    type: 'alert',
                    title: `Alert ${i}`,
                    message: `Message ${i}`,
                });
            }

            const result = await notificationsService.getUserNotifications(user.id, {
                offset: 2,
                limit: 10,
            });

            expect(result.notifications).toHaveLength(3);
        });

        it('should order by created_at descending', async () => {
            const user = await createTestUser();

            await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'First',
                message: 'First message',
            });

            await new Promise((resolve) => setTimeout(resolve, 10));

            await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'Second',
                message: 'Second message',
            });

            const result = await notificationsService.getUserNotifications(user.id);

            expect(result.notifications[0].title).toBe('Second');
            expect(result.notifications[1].title).toBe('First');
        });

        it('should include organization and project details', async () => {
            const { user, organization, project } = await createTestContext();

            await notificationsService.createNotification({
                userId: user.id,
                type: 'project_update',
                title: 'Project Update',
                message: 'Your project was updated',
                organizationId: organization.id,
                projectId: project.id,
            });

            const result = await notificationsService.getUserNotifications(user.id);

            expect(result.notifications[0].organizationName).toBe(organization.name);
            expect(result.notifications[0].projectName).toBe(project.name);
        });
    });

    describe('markAsRead', () => {
        it('should mark a notification as read', async () => {
            const user = await createTestUser();

            const notification = await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'Test',
                message: 'Test message',
            });

            expect(notification.read).toBe(false);

            await notificationsService.markAsRead(notification.id, user.id);

            const result = await notificationsService.getUserNotifications(user.id);
            expect(result.notifications[0].read).toBe(true);
        });

        it('should not mark another user notification as read', async () => {
            const user1 = await createTestUser({ email: 'user1@test.com' });
            const user2 = await createTestUser({ email: 'user2@test.com' });

            const notification = await notificationsService.createNotification({
                userId: user1.id,
                type: 'alert',
                title: 'Test',
                message: 'Test message',
            });

            // Try to mark as read with wrong user
            await notificationsService.markAsRead(notification.id, user2.id);

            // Should still be unread
            const result = await notificationsService.getUserNotifications(user1.id);
            expect(result.notifications[0].read).toBe(false);
        });

        it('should update unread count after marking as read', async () => {
            const user = await createTestUser();

            await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'Test 1',
                message: 'Test message 1',
            });

            const n2 = await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'Test 2',
                message: 'Test message 2',
            });

            let result = await notificationsService.getUserNotifications(user.id);
            expect(result.unreadCount).toBe(2);

            await notificationsService.markAsRead(n2.id, user.id);

            result = await notificationsService.getUserNotifications(user.id);
            expect(result.unreadCount).toBe(1);
        });
    });

    describe('markAllAsRead', () => {
        it('should mark all notifications as read', async () => {
            const user = await createTestUser();

            for (let i = 0; i < 5; i++) {
                await notificationsService.createNotification({
                    userId: user.id,
                    type: 'alert',
                    title: `Alert ${i}`,
                    message: `Message ${i}`,
                });
            }

            let result = await notificationsService.getUserNotifications(user.id);
            expect(result.unreadCount).toBe(5);

            await notificationsService.markAllAsRead(user.id);

            result = await notificationsService.getUserNotifications(user.id);
            expect(result.unreadCount).toBe(0);
            expect(result.notifications.every((n) => n.read)).toBe(true);
        });

        it('should not affect other users notifications', async () => {
            const user1 = await createTestUser({ email: 'user1@test.com' });
            const user2 = await createTestUser({ email: 'user2@test.com' });

            await notificationsService.createNotification({
                userId: user1.id,
                type: 'alert',
                title: 'User 1 Alert',
                message: 'Message',
            });

            await notificationsService.createNotification({
                userId: user2.id,
                type: 'alert',
                title: 'User 2 Alert',
                message: 'Message',
            });

            await notificationsService.markAllAsRead(user1.id);

            const result1 = await notificationsService.getUserNotifications(user1.id);
            const result2 = await notificationsService.getUserNotifications(user2.id);

            expect(result1.unreadCount).toBe(0);
            expect(result2.unreadCount).toBe(1);
        });
    });

    describe('deleteNotification', () => {
        it('should delete a notification', async () => {
            const user = await createTestUser();

            const notification = await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'To Delete',
                message: 'Will be deleted',
            });

            let result = await notificationsService.getUserNotifications(user.id);
            expect(result.notifications).toHaveLength(1);

            await notificationsService.deleteNotification(notification.id, user.id);

            result = await notificationsService.getUserNotifications(user.id);
            expect(result.notifications).toHaveLength(0);
        });

        it('should not delete another user notification', async () => {
            const user1 = await createTestUser({ email: 'user1@test.com' });
            const user2 = await createTestUser({ email: 'user2@test.com' });

            const notification = await notificationsService.createNotification({
                userId: user1.id,
                type: 'alert',
                title: 'Test',
                message: 'Test message',
            });

            // Try to delete with wrong user
            await notificationsService.deleteNotification(notification.id, user2.id);

            // Should still exist
            const result = await notificationsService.getUserNotifications(user1.id);
            expect(result.notifications).toHaveLength(1);
        });
    });

    describe('deleteAllNotifications', () => {
        it('should delete all notifications for a user', async () => {
            const user = await createTestUser();

            for (let i = 0; i < 5; i++) {
                await notificationsService.createNotification({
                    userId: user.id,
                    type: 'alert',
                    title: `Alert ${i}`,
                    message: `Message ${i}`,
                });
            }

            let result = await notificationsService.getUserNotifications(user.id);
            expect(result.notifications).toHaveLength(5);

            const deletedCount = await notificationsService.deleteAllNotifications(user.id);

            expect(deletedCount).toBe(5);

            result = await notificationsService.getUserNotifications(user.id);
            expect(result.notifications).toHaveLength(0);
        });

        it('should return 0 when no notifications exist', async () => {
            const user = await createTestUser();

            const deletedCount = await notificationsService.deleteAllNotifications(user.id);

            expect(deletedCount).toBe(0);
        });

        it('should not affect other users notifications', async () => {
            const user1 = await createTestUser({ email: 'user1@test.com' });
            const user2 = await createTestUser({ email: 'user2@test.com' });

            await notificationsService.createNotification({
                userId: user1.id,
                type: 'alert',
                title: 'User 1 Alert',
                message: 'Message',
            });

            await notificationsService.createNotification({
                userId: user2.id,
                type: 'alert',
                title: 'User 2 Alert',
                message: 'Message',
            });

            await notificationsService.deleteAllNotifications(user1.id);

            const result1 = await notificationsService.getUserNotifications(user1.id);
            const result2 = await notificationsService.getUserNotifications(user2.id);

            expect(result1.notifications).toHaveLength(0);
            expect(result2.notifications).toHaveLength(1);
        });
    });

    describe('cleanupOldNotifications', () => {
        it('should delete old read notifications', async () => {
            const user = await createTestUser();

            // Create a notification
            const notification = await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'Old Alert',
                message: 'Old message',
            });

            // Mark as read
            await notificationsService.markAsRead(notification.id, user.id);

            // Manually update created_at to be old
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 31);
            await db
                .updateTable('notifications')
                .set({ created_at: oldDate })
                .where('id', '=', notification.id)
                .execute();

            const deletedCount = await notificationsService.cleanupOldNotifications(30);

            expect(deletedCount).toBe(1);
        });

        it('should not delete unread notifications', async () => {
            const user = await createTestUser();

            const notification = await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'Old Unread Alert',
                message: 'Old unread message',
            });

            // Manually update created_at to be old but keep unread
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 31);
            await db
                .updateTable('notifications')
                .set({ created_at: oldDate })
                .where('id', '=', notification.id)
                .execute();

            const deletedCount = await notificationsService.cleanupOldNotifications(30);

            expect(deletedCount).toBe(0);

            const result = await notificationsService.getUserNotifications(user.id);
            expect(result.notifications).toHaveLength(1);
        });

        it('should not delete recent read notifications', async () => {
            const user = await createTestUser();

            const notification = await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'Recent Alert',
                message: 'Recent message',
            });

            await notificationsService.markAsRead(notification.id, user.id);

            const deletedCount = await notificationsService.cleanupOldNotifications(30);

            expect(deletedCount).toBe(0);

            const result = await notificationsService.getUserNotifications(user.id);
            expect(result.notifications).toHaveLength(1);
        });

        it('should use custom days parameter', async () => {
            const user = await createTestUser();

            const notification = await notificationsService.createNotification({
                userId: user.id,
                type: 'alert',
                title: 'Alert',
                message: 'Message',
            });

            await notificationsService.markAsRead(notification.id, user.id);

            // Set to 8 days old
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 8);
            await db
                .updateTable('notifications')
                .set({ created_at: oldDate })
                .where('id', '=', notification.id)
                .execute();

            // Should not delete with 10 days threshold
            let deletedCount = await notificationsService.cleanupOldNotifications(10);
            expect(deletedCount).toBe(0);

            // Should delete with 7 days threshold
            deletedCount = await notificationsService.cleanupOldNotifications(7);
            expect(deletedCount).toBe(1);
        });
    });
});
