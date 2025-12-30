import { db } from '../database/connection.js';
import { randomBytes, createHash } from 'crypto';
import bcrypt from 'bcrypt';

/**
 * Bootstrap the internal logging setup
 * Creates organization, project, and API key for LogWard self-monitoring
 */
export async function bootstrapInternalLogging(): Promise<string | null> {
  try {

    // 1. Check if internal organization exists
    let organization = await db
      .selectFrom('organizations')
      .selectAll()
      .where('slug', '=', 'logward-internal')
      .executeTakeFirst();

    if (!organization) {

      // Find an admin user to be the owner of the internal organization
      // Priority: 1) Any existing admin with password (real user), 2) Create system user as fallback
      let ownerUser = await db
        .selectFrom('users')
        .selectAll()
        .where('is_admin', '=', true)
        .where('password_hash', '!=', '') // Real user with login credentials
        .orderBy('created_at', 'asc') // Use the first admin created
        .executeTakeFirst();

      if (!ownerUser) {
        // Fallback: check for existing system user or create one
        ownerUser = await db
          .selectFrom('users')
          .selectAll()
          .where('email', '=', 'system@logward.internal')
          .executeTakeFirst();

        if (!ownerUser) {
          // Generate a random password for the system user
          const generatedPassword = randomBytes(16).toString('base64url');
          const passwordHash = await bcrypt.hash(generatedPassword, 10);

          ownerUser = await db
            .insertInto('users')
            .values({
              email: 'system@logward.internal',
              password_hash: passwordHash,
              name: 'System Admin',
              is_admin: true,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

          // Log the credentials so the admin can use them
          console.log('');
          console.log('╔════════════════════════════════════════════════════════════════╗');
          console.log('║  INITIAL ADMIN CREDENTIALS (save these!)                       ║');
          console.log('╠════════════════════════════════════════════════════════════════╣');
          console.log(`║  Email:    system@logward.internal                             ║`);
          console.log(`║  Password: ${generatedPassword.padEnd(40)}       ║`);
          console.log('╠════════════════════════════════════════════════════════════════╣');
          console.log('║  Change your password after first login!                       ║');
          console.log('║  Or set INITIAL_ADMIN_* env vars for future deployments.       ║');
          console.log('╚════════════════════════════════════════════════════════════════╝');
          console.log('');
        }
      }

      // Create internal organization
      organization = await db
        .insertInto('organizations')
        .values({
          name: 'LogWard',
          slug: 'logward-internal',
          description: 'Internal monitoring and logging',
          owner_id: ownerUser.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    // 2. Check if internal project exists
    let project = await db
      .selectFrom('projects')
      .selectAll()
      .where('organization_id', '=', organization.id)
      .where('name', '=', 'Internal Monitoring')
      .executeTakeFirst();

    if (!project) {

      project = await db
        .insertInto('projects')
        .values({
          organization_id: organization.id,
          user_id: organization.owner_id,
          name: 'Internal Monitoring',
          description: 'Self-monitoring logs for LogWard backend and worker',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    // 3. Check if API key exists
    let apiKey = await db
      .selectFrom('api_keys')
      .selectAll()
      .where('project_id', '=', project.id)
      .where('name', '=', 'Internal SDK Key')
      .where('revoked', '=', false)
      .executeTakeFirst();

    if (!apiKey) {

      // Generate API key
      const rawKey = randomBytes(32).toString('hex');
      const keyWithPrefix = `lp_${rawKey}`;
      const keyHash = createHash('sha256').update(keyWithPrefix).digest('hex');

      apiKey = await db
        .insertInto('api_keys')
        .values({
          project_id: project.id,
          name: 'Internal SDK Key',
          key_hash: keyHash,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return keyWithPrefix;
    } else {
      // Return null - key already exists but we can't retrieve the raw key
      // User must set INTERNAL_API_KEY env variable manually
      return null;
    }
  } catch (error) {
    console.error('[Internal Logging] ❌ Failed to bootstrap internal logging:', error);
    return null;
  }
}

/**
 * Get the internal API key from environment or bootstrap
 */
export async function getInternalApiKey(): Promise<string | null> {
  // Check if API key is in environment
  const envKey = process.env.INTERNAL_API_KEY;
  if (envKey) {
    return envKey;
  }

  // Try to bootstrap (will only work on first run)
  const bootstrappedKey = await bootstrapInternalLogging();

  if (!bootstrappedKey) {
    console.warn(
      '[Internal Logging] ⚠️  No API key found. Please set INTERNAL_API_KEY environment variable.',
    );
    console.warn(
      '[Internal Logging] ⚠️  You can find the key in the database or create a new one via the dashboard.',
    );
  }

  return bootstrappedKey;
}
