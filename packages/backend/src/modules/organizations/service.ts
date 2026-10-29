import { db } from '../../database/connection.js';
import { notificationsService } from '../notifications/service.js';
import { auditLogService } from '../audit-log/service.js';
import { config } from '../../config/index.js';
import { withLimitLock } from '../../capabilities/limit-lock.js';
import { validateSlug } from '../../utils/slug.js';
import { CacheManager } from '../../utils/cache.js';
import { capabilities } from '../../capabilities/facade.js';
import type { Organization, OrganizationMember, OrganizationMemberWithUser, OrganizationWithRole, OrgRole } from '@logtide/shared';

export interface CreateOrganizationInput {
  userId: string;
  name: string;
  description?: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
  description?: string;
}

/** Thrown when a transfer would exceed MAX_ORGANIZATIONS_PER_USER for the receiver. */
export class OrganizationLimitError extends Error {
  constructor(public readonly max: number) {
    super('organization_limit_reached');
    this.name = 'OrganizationLimitError';
  }
}

export class OrganizationsService {
  /**
   * Generate a slug from a name
   */
  private generateSlugFromName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .substring(0, 255);
  }

  /**
   * Find a unique slug by appending a number if needed
   */
  private async findUniqueSlug(baseSlug: string): Promise<string> {
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await db
        .selectFrom('organizations')
        .select('id')
        .where('slug', '=', slug)
        .executeTakeFirst();

      if (!existing) {
        return slug;
      }

      // Append counter to make it unique
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  }

  /** Count organizations a user owns (organization_members role 'owner'). */
  async countOwnedOrganizations(userId: string): Promise<number> {
    const row = await db
      .selectFrom('organization_members')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('user_id', '=', userId)
      .where('role', '=', 'owner')
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /** Count organizations the user created since `since` (survives org deletion). */
  async countCreationsSince(userId: string, since: Date): Promise<number> {
    const row = await db
      .selectFrom('organization_creation_log')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('user_id', '=', userId)
      .where('created_at', '>=', since)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /**
   * Create a new organization
   */
  async createOrganization(input: CreateOrganizationInput): Promise<Organization> {
    // Generate slug from name
    const baseSlug = this.generateSlugFromName(input.name);

    // Find unique slug
    const uniqueSlug = await this.findUniqueSlug(baseSlug);

    // Org, owner membership and the creation log row commit together
    const org = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('organizations')
        .values({
          name: input.name,
          slug: uniqueSlug,
          description: input.description || null,
          owner_id: input.userId,
        })
        .returning(['id', 'name', 'slug', 'description', 'owner_id', 'retention_days', 'created_at', 'updated_at'])
        .executeTakeFirstOrThrow();

      // Add user as owner member
      await trx
        .insertInto('organization_members')
        .values({
          organization_id: created.id,
          user_id: input.userId,
          role: 'owner',
        })
        .execute();

      // Append-only bookkeeping for MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH
      await trx
        .insertInto('organization_creation_log')
        .values({ user_id: input.userId, organization_id: created.id })
        .execute();

      return created;
    });

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      description: org.description || undefined,
      ownerId: org.owner_id,
      retentionDays: org.retention_days,
      createdAt: new Date(org.created_at),
      updatedAt: new Date(org.updated_at),
    };
  }

  /**
   * Get all organizations for a user (with their role)
   */
  async getUserOrganizations(userId: string): Promise<OrganizationWithRole[]> {
    const organizations = await db
      .selectFrom('organizations')
      .innerJoin('organization_members', 'organizations.id', 'organization_members.organization_id')
      .select([
        'organizations.id',
        'organizations.name',
        'organizations.slug',
        'organizations.description',
        'organizations.owner_id',
        'organizations.retention_days',
        'organizations.created_at',
        'organizations.updated_at',
        'organization_members.role',
      ])
      .where('organization_members.user_id', '=', userId)
      .orderBy('organizations.created_at', 'desc')
      .execute();

    return organizations.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      description: org.description || undefined,
      ownerId: org.owner_id,
      retentionDays: org.retention_days,
      createdAt: new Date(org.created_at),
      updatedAt: new Date(org.updated_at),
      role: org.role as OrgRole,
    }));
  }

  /**
   * Get an organization by ID
   */
  async getOrganizationById(
    organizationId: string,
    userId: string
  ): Promise<OrganizationWithRole | null> {
    const org = await db
      .selectFrom('organizations')
      .innerJoin('organization_members', 'organizations.id', 'organization_members.organization_id')
      .select([
        'organizations.id',
        'organizations.name',
        'organizations.slug',
        'organizations.description',
        'organizations.owner_id',
        'organizations.retention_days',
        'organizations.created_at',
        'organizations.updated_at',
        'organization_members.role',
      ])
      .where('organizations.id', '=', organizationId)
      .where('organization_members.user_id', '=', userId)
      .executeTakeFirst();

    if (!org) {
      return null;
    }

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      description: org.description || undefined,
      ownerId: org.owner_id,
      retentionDays: org.retention_days,
      createdAt: new Date(org.created_at),
      updatedAt: new Date(org.updated_at),
      role: org.role as OrgRole,
    };
  }

  /**
   * Get an organization by slug
   */
  async getOrganizationBySlug(
    slug: string,
    userId: string
  ): Promise<OrganizationWithRole | null> {
    const org = await db
      .selectFrom('organizations')
      .innerJoin('organization_members', 'organizations.id', 'organization_members.organization_id')
      .select([
        'organizations.id',
        'organizations.name',
        'organizations.slug',
        'organizations.description',
        'organizations.owner_id',
        'organizations.retention_days',
        'organizations.created_at',
        'organizations.updated_at',
        'organization_members.role',
      ])
      .where('organizations.slug', '=', slug)
      .where('organization_members.user_id', '=', userId)
      .executeTakeFirst();

    if (!org) {
      return null;
    }

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      description: org.description || undefined,
      ownerId: org.owner_id,
      retentionDays: org.retention_days,
      createdAt: new Date(org.created_at),
      updatedAt: new Date(org.updated_at),
      role: org.role as OrgRole,
    };
  }

  /**
   * Update an organization (owner only)
   */
  async updateOrganization(
    organizationId: string,
    userId: string,
    input: UpdateOrganizationInput
  ): Promise<Organization> {
    // Check if user is owner
    const org = await db
      .selectFrom('organizations')
      .select('owner_id')
      .where('id', '=', organizationId)
      .executeTakeFirst();

    if (!org) {
      throw new Error('Organization not found');
    }

    if (org.owner_id !== userId) {
      throw new Error('Only the organization owner can update it');
    }

    // Wrap slug generation + update in a transaction to prevent duplicate slugs under concurrent requests
    const updated = await db.transaction().execute(async (trx) => {
      let newSlug: string | undefined;

      if (input.slug !== undefined) {
        // Explicit slug from user: validate + global uniqueness check
        const validationError = validateSlug(input.slug);
        if (validationError) {
          throw new Error(validationError);
        }
        const conflict = await trx
          .selectFrom('organizations')
          .select('id')
          .where('slug', '=', input.slug)
          .where('id', '!=', organizationId)
          .executeTakeFirst();
        if (conflict) {
          throw new Error('An organization with this slug already exists');
        }
        newSlug = input.slug;
      } else if (input.name) {
        // Auto-regenerate from name (existing behavior, excluding self from conflict)
        const baseSlug = this.generateSlugFromName(input.name);
        let slug = baseSlug;
        let counter = 1;
        while (true) {
          const existing = await trx
            .selectFrom('organizations')
            .select('id')
            .where('slug', '=', slug)
            .where('id', '!=', organizationId)
            .executeTakeFirst();
          if (!existing) break;
          slug = `${baseSlug}-${counter++}`;
        }
        newSlug = slug;
      }

      return trx
        .updateTable('organizations')
        .set({
          ...(input.name && { name: input.name }),
          ...(newSlug && { slug: newSlug }),
          ...(input.description !== undefined && { description: input.description || null }),
          updated_at: new Date(),
        })
        .where('id', '=', organizationId)
        .returning(['id', 'name', 'slug', 'description', 'owner_id', 'retention_days', 'created_at', 'updated_at'])
        .executeTakeFirstOrThrow();
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      description: updated.description || undefined,
      ownerId: updated.owner_id,
      retentionDays: updated.retention_days,
      createdAt: new Date(updated.created_at),
      updatedAt: new Date(updated.updated_at),
    };
  }

  /**
   * Delete an organization (owner only)
   */
  async deleteOrganization(organizationId: string, userId: string): Promise<void> {
    // Check if user is owner
    const org = await db
      .selectFrom('organizations')
      .select('owner_id')
      .where('id', '=', organizationId)
      .executeTakeFirst();

    if (!org) {
      throw new Error('Organization not found');
    }

    if (org.owner_id !== userId) {
      throw new Error('Only the organization owner can delete it');
    }

    await this.removeOrganization(organizationId);
  }

  /**
   * Delete an organization row (cascade removes members, projects, keys...)
   * and drop the caches that would otherwise keep its API keys and
   * entitlements alive until their TTL. No access check: callers authorize.
   * Returns false when the organization does not exist.
   */
  async removeOrganization(organizationId: string): Promise<boolean> {
    const keys = await db
      .selectFrom('api_keys')
      .innerJoin('projects', 'projects.id', 'api_keys.project_id')
      .select(['api_keys.key_hash', 'api_keys.project_id'])
      .where('projects.organization_id', '=', organizationId)
      .execute();
    const projectIds = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', organizationId)
      .execute();

    const result = await db.deleteFrom('organizations').where('id', '=', organizationId).executeTakeFirst();
    if (Number(result.numDeletedRows || 0) === 0) return false;

    await Promise.all([
      ...keys.map((k) => CacheManager.invalidateApiKey(k.key_hash)),
      ...projectIds.map((p) => CacheManager.invalidateProjectCache(p.id)),
      CacheManager.invalidateOrgCache(organizationId),
    ]);
    capabilities.invalidate(organizationId);
    return true;
  }

  /**
   * Get organization members
   */
  async getOrganizationMembers(
    organizationId: string,
    userId: string
  ): Promise<OrganizationMember[]> {
    // Check if user has access to this organization
    const hasAccess = await db
      .selectFrom('organization_members')
      .select('id')
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!hasAccess) {
      throw new Error('You do not have access to this organization');
    }

    const members = await db
      .selectFrom('organization_members')
      .select(['id', 'organization_id', 'user_id', 'role', 'created_at'])
      .where('organization_id', '=', organizationId)
      .execute();

    return members.map((m) => ({
      id: m.id,
      organizationId: m.organization_id,
      userId: m.user_id,
      role: m.role as OrgRole,
      createdAt: new Date(m.created_at),
    }));
  }

  /**
   * Get organization members with user details
   */
  async getOrganizationMembersWithDetails(
    organizationId: string,
    userId: string
  ): Promise<OrganizationMemberWithUser[]> {
    // Check if user has access to this organization
    const hasAccess = await db
      .selectFrom('organization_members')
      .select('id')
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!hasAccess) {
      throw new Error('You do not have access to this organization');
    }

    const members = await db
      .selectFrom('organization_members')
      .innerJoin('users', 'organization_members.user_id', 'users.id')
      .select([
        'organization_members.id',
        'organization_members.organization_id',
        'organization_members.user_id',
        'organization_members.role',
        'organization_members.created_at',
        'users.name',
        'users.email',
      ])
      .where('organization_members.organization_id', '=', organizationId)
      .orderBy('organization_members.created_at', 'asc')
      .execute();

    return members.map((m) => ({
      id: m.id,
      organizationId: m.organization_id,
      userId: m.user_id,
      role: m.role as OrgRole,
      createdAt: new Date(m.created_at),
      user: {
        id: m.user_id,
        name: m.name,
        email: m.email,
      },
    }));
  }

  /**
   * Role of a user in an organization, or null when not a member
   */
  async getMemberRole(organizationId: string, userId: string): Promise<OrgRole | null> {
    const member = await db
      .selectFrom('organization_members')
      .select(['role'])
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return (member?.role as OrgRole | undefined) ?? null;
  }

  /**
   * Check if user is owner or admin
   */
  async isOwnerOrAdmin(organizationId: string, userId: string): Promise<boolean> {
    const member = await db
      .selectFrom('organization_members')
      .select(['role'])
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return member?.role === 'owner' || member?.role === 'admin';
  }

  /**
   * Update member role (owner/admin only)
   */
  async updateMemberRole(
    organizationId: string,
    memberId: string,
    newRole: OrgRole,
    userId: string
  ): Promise<void> {
    // Check if user has permission
    const currentUserMember = await db
      .selectFrom('organization_members')
      .select(['role'])
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!currentUserMember || (currentUserMember.role !== 'owner' && currentUserMember.role !== 'admin')) {
      throw new Error('Only owners and admins can change member roles');
    }

    // Get target member
    const targetMember = await db
      .selectFrom('organization_members')
      .select(['user_id', 'role'])
      .where('id', '=', memberId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!targetMember) {
      throw new Error('Member not found');
    }

    // Prevent changing owner role (unless you're the owner)
    if (targetMember.role === 'owner' && currentUserMember.role !== 'owner') {
      throw new Error('Only the owner can change the owner role');
    }

    // Prevent changing to owner (unless you're the owner)
    if (newRole === 'owner' && currentUserMember.role !== 'owner') {
      throw new Error('Only the owner can promote someone to owner');
    }

    // Don't allow self-demotion from owner
    if (targetMember.user_id === userId && currentUserMember.role === 'owner' && newRole !== 'owner') {
      throw new Error('Cannot demote yourself from owner. Transfer ownership first.');
    }

    // Admins may only manage plain members and may not grant the admin role
    // (creating peer admins is owner-only), consistent with removeMember.
    if (currentUserMember.role === 'admin' && (targetMember.role !== 'member' || newRole !== 'member')) {
      throw new Error('Admins can only manage member-level roles');
    }

    await db
      .updateTable('organization_members')
      .set({ role: newRole })
      .where('id', '=', memberId)
      .execute();

    // Create notification for the affected user
    const org = await db
      .selectFrom('organizations')
      .select(['name'])
      .where('id', '=', organizationId)
      .executeTakeFirst();

    if (org && targetMember.user_id !== userId) {
      await notificationsService.createNotification({
        userId: targetMember.user_id,
        type: 'system',
        title: `Role changed in ${org.name}`,
        message: `Your role has been changed to ${newRole}`,
        organizationId,
      });
    }
  }

  /**
   * Remove member from organization (owner/admin only)
   */
  async removeMember(
    organizationId: string,
    memberId: string,
    userId: string
  ): Promise<void> {
    // Check if user has permission
    const currentUserMember = await db
      .selectFrom('organization_members')
      .select(['role', 'user_id'])
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!currentUserMember) {
      throw new Error('You are not a member of this organization');
    }

    if (currentUserMember.role !== 'owner' && currentUserMember.role !== 'admin') {
      throw new Error('Only owners and admins can remove members');
    }

    // Get target member
    const targetMember = await db
      .selectFrom('organization_members')
      .select(['role', 'user_id'])
      .where('id', '=', memberId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!targetMember) {
      throw new Error('Member not found');
    }

    // Cannot remove yourself
    if (targetMember.user_id === userId) {
      throw new Error('Cannot remove yourself. Use leave organization instead.');
    }

    // Cannot remove owner
    if (targetMember.role === 'owner') {
      throw new Error('Cannot remove the organization owner');
    }

    // Admin cannot remove other admin or owner
    if (currentUserMember.role === 'admin' && targetMember.role !== 'member') {
      throw new Error('Admins can only remove members');
    }

    await db
      .deleteFrom('organization_members')
      .where('id', '=', memberId)
      .where('organization_id', '=', organizationId)
      .execute();

    // Notify the removed user
    const org = await db
      .selectFrom('organizations')
      .select(['name'])
      .where('id', '=', organizationId)
      .executeTakeFirst();

    if (org) {
      await notificationsService.createNotification({
        userId: targetMember.user_id,
        type: 'system',
        title: `Removed from ${org.name}`,
        message: `You have been removed from ${org.name}`,
        organizationId,
      });
    }
  }

  /**
   * Leave organization (member self-removal)
   */
  async leaveOrganization(organizationId: string, userId: string): Promise<void> {
    const member = await db
      .selectFrom('organization_members')
      .select(['id', 'role'])
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!member) {
      throw new Error('You are not a member of this organization');
    }

    if (member.role === 'owner') {
      throw new Error('Cannot leave as owner. Transfer ownership or delete the organization.');
    }

    await db
      .deleteFrom('organization_members')
      .where('id', '=', member.id)
      .execute();
  }

  /**
   * Transfer ownership to another member. The previous owner becomes an admin.
   * The organization row is locked so concurrent transfers serialize and
   * exactly one owner remains. When MAX_ORGANIZATIONS_PER_USER is set the
   * receiver must have a free ownership slot (same per-user lock as creation).
   * The audit row is written inside the transaction; the notification is best effort.
   */
  async transferOwnership(
    organizationId: string,
    currentOwnerId: string,
    newOwnerUserId: string
  ): Promise<{ previousOwnerId: string; newOwnerId: string }> {
    const run = async () =>
      db.transaction().execute(async (trx) => {
        const org = await trx
          .selectFrom('organizations')
          .select(['id', 'name', 'owner_id'])
          .where('id', '=', organizationId)
          .forUpdate()
          .executeTakeFirst();

        if (!org) {
          throw new Error('Organization not found');
        }

        if (org.owner_id !== currentOwnerId) {
          throw new Error('Only the organization owner can transfer ownership');
        }

        if (newOwnerUserId === currentOwnerId) {
          throw new Error('You already own this organization');
        }

        const target = await trx
          .selectFrom('organization_members')
          .innerJoin('users', 'users.id', 'organization_members.user_id')
          .select(['organization_members.id'])
          .where('organization_members.organization_id', '=', organizationId)
          .where('organization_members.user_id', '=', newOwnerUserId)
          .where('users.disabled', '=', false)
          .forUpdate('organization_members')
          .executeTakeFirst();

        if (!target) {
          throw new Error('The new owner must be a member of this organization');
        }

        const maxOwned = config.MAX_ORGANIZATIONS_PER_USER;
        if (maxOwned !== undefined) {
          const owned = await this.countOwnedOrganizations(newOwnerUserId);
          if (owned >= maxOwned) {
            throw new OrganizationLimitError(maxOwned);
          }
        }

        await trx
          .updateTable('organizations')
          .set({ owner_id: newOwnerUserId })
          .where('id', '=', organizationId)
          .execute();

        const promoted = await trx
          .updateTable('organization_members')
          .set({ role: 'owner' })
          .where('organization_id', '=', organizationId)
          .where('user_id', '=', newOwnerUserId)
          .executeTakeFirst();
        if (Number(promoted.numUpdatedRows) !== 1) {
          throw new Error('The new owner must be a member of this organization');
        }

        await trx
          .updateTable('organization_members')
          .set({ role: 'admin' })
          .where('organization_id', '=', organizationId)
          .where('user_id', '=', currentOwnerId)
          .execute();

        await auditLogService.record(
          {
            action: 'org.ownership_transferred',
            target: { type: 'organization', id: organizationId },
            organizationId,
            metadata: { previousOwnerId: currentOwnerId, newOwnerId: newOwnerUserId },
          },
          { trx }
        );

        return org.name;
      });

    const orgName =
      config.MAX_ORGANIZATIONS_PER_USER !== undefined
        ? await withLimitLock(`user:${newOwnerUserId}`, 'organizations.create', run)
        : await run();

    try {
      const title = `You are now the owner of ${orgName}`;
      await notificationsService.createNotification({
        userId: newOwnerUserId,
        type: 'system',
        title: title.length > 255 ? `${title.slice(0, 254)}…` : title,
        message: `Ownership of ${orgName} was transferred to you`,
        organizationId,
      });
    } catch (err) {
      console.error('[Organizations] ownership transfer notification failed:', err);
    }

    return { previousOwnerId: currentOwnerId, newOwnerId: newOwnerUserId };
  }
}
