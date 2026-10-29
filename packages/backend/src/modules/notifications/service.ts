import { db } from '../../database/connection.js';

export interface Notification {
  id: string;
  userId: string;
  type: 'alert' | 'system' | 'organization_invite' | 'project_update' | 'monitoring' | 'project_health';
  title: string;
  message: string;
  read: boolean;
  organizationId: string | null;
  projectId: string | null;
  metadata: any;
  createdAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  type: Notification['type'];
  title: string;
  message: string;
  organizationId?: string;
  projectId?: string;
  metadata?: any;
}

export class NotificationsService {
  /**
   * Create a new notification
   */
  async createNotification(input: CreateNotificationInput): Promise<Notification> {
    const notification = await db
      .insertInto('notifications')
      .values({
        user_id: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        organization_id: input.organizationId,
        project_id: input.projectId,
        metadata: input.metadata ?? null,
      })
      .returning([
        'id',
        'user_id',
        'type',
        'title',
        'message',
        'read',
        'organization_id',
        'project_id',
        'metadata',
        'created_at',
      ])
      .executeTakeFirstOrThrow();

    return this.mapNotification(notification);
  }

  /**
   * Get all notifications for a user
   */
  async getUserNotifications(
    userId: string,
    options?: {
      unreadOnly?: boolean;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
    let query = db
      .selectFrom('notifications')
      .leftJoin('organizations', 'notifications.organization_id', 'organizations.id')
      .leftJoin('projects', 'notifications.project_id', 'projects.id')
      .select([
        'notifications.id',
        'notifications.user_id',
        'notifications.type',
        'notifications.title',
        'notifications.message',
        'notifications.read',
        'notifications.organization_id',
        'notifications.project_id',
        'notifications.metadata',
        'notifications.created_at',
        'organizations.name as organization_name',
        'organizations.slug as organization_slug',
        'projects.name as project_name',
      ])
      .where('notifications.user_id', '=', userId)
      .orderBy('notifications.created_at', 'desc');

    if (options?.unreadOnly) {
      query = query.where('notifications.read', '=', false);
    }

    // Get total count
    const countQuery = db
      .selectFrom('notifications')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('user_id', '=', userId);

    const unreadCountQuery = db
      .selectFrom('notifications')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('user_id', '=', userId)
      .where('read', '=', false);

    const [countResult, unreadCountResult, notifications] = await Promise.all([
      countQuery.executeTakeFirst(),
      unreadCountQuery.executeTakeFirst(),
      query
        .limit(options?.limit ?? 50)
        .offset(options?.offset ?? 0)
        .execute(),
    ]);

    return {
      notifications: notifications.map((n) => this.mapNotificationWithDetails(n)),
      total: Number(countResult?.count ?? 0),
      unreadCount: Number(unreadCountResult?.count ?? 0),
    };
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    await db
      .updateTable('notifications')
      .set({ read: true })
      .where('id', '=', notificationId)
      .where('user_id', '=', userId)
      .execute();
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<void> {
    await db
      .updateTable('notifications')
      .set({ read: true })
      .where('user_id', '=', userId)
      .where('read', '=', false)
      .execute();
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    await db
      .deleteFrom('notifications')
      .where('id', '=', notificationId)
      .where('user_id', '=', userId)
      .execute();
  }

  /**
   * Delete all notifications for a user
   */
  async deleteAllNotifications(userId: string): Promise<number> {
    const result = await db
      .deleteFrom('notifications')
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return Number(result.numDeletedRows || 0);
  }

  /**
   * Delete old read notifications (cleanup job)
   */
  async cleanupOldNotifications(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await db
      .deleteFrom('notifications')
      .where('read', '=', true)
      .where('created_at', '<', cutoffDate)
      .executeTakeFirst();

    return Number(result.numDeletedRows || 0);
  }

  private mapNotification(row: any): Notification {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      title: row.title,
      message: row.message,
      read: row.read,
      organizationId: row.organization_id,
      projectId: row.project_id,
      metadata: row.metadata,
      createdAt: new Date(row.created_at),
    };
  }

  private mapNotificationWithDetails(row: any): any {
    const notification = this.mapNotification(row);
    return {
      ...notification,
      organizationName: row.organization_name,
      organizationSlug: row.organization_slug,
      projectName: row.project_name,
    };
  }
}

export const notificationsService = new NotificationsService();
