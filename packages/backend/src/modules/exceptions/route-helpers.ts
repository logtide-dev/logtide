/**
 * Shared helpers for the exception route plugins.
 */

import { usersService } from '../users/service.js';
import { OrganizationsService } from '../organizations/service.js';

const organizationsService = new OrganizationsService();

/**
 * Middleware to extract and validate session token
 */
export async function authenticate(request: any, reply: any) {
  const token = request.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return reply.status(401).send({
      error: 'No token provided',
    });
  }

  const user = await usersService.validateSession(token);

  if (!user) {
    return reply.status(401).send({
      error: 'Invalid or expired session',
    });
  }

  request.user = user;
}

/**
 * Check if user is member of organization
 */
export async function checkOrganizationMembership(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const organizations = await organizationsService.getUserOrganizations(userId);
  return organizations.some((org) => org.id === organizationId);
}
