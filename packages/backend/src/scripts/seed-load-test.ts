/**
 * Seed script for load testing
 * Creates a test user, organization, project, and API key
 * Outputs the API key to stdout for use in k6 tests
 */

import { db } from '../database/index.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const LOAD_TEST_EMAIL = 'loadtest@logtide.dev';
const LOAD_TEST_ORG_SLUG = 'load-test-org';

async function seedLoadTestData() {
    console.error('🌱 Seeding load test data...');

    // Check if load test user already exists
    const existingUser = await db
        .selectFrom('users')
        .select(['id'])
        .where('email', '=', LOAD_TEST_EMAIL)
        .executeTakeFirst();

    if (existingUser) {
        console.error('⚠️  Load test data already exists, fetching existing API key...');

        // Get existing project and API key
        const org = await db
            .selectFrom('organizations')
            .select(['id'])
            .where('slug', '=', LOAD_TEST_ORG_SLUG)
            .executeTakeFirstOrThrow();

        const project = await db
            .selectFrom('projects')
            .select(['id'])
            .where('organization_id', '=', org.id)
            .executeTakeFirst();

        if (project) {
            // Create a new API key (we can't recover the old one)
            const key = `lp_load_${crypto.randomBytes(16).toString('hex')}`;
            const keyHash = crypto.createHash('sha256').update(key).digest('hex');

            await db
                .insertInto('api_keys')
                .values({
                    project_id: project.id,
                    name: `Load Test Key ${Date.now()}`,
                    key_hash: keyHash,
                    last_used: null,
                })
                .execute();

            // Output only the API key to stdout (for scripts to capture)
            console.log(key);
            console.error('✅ New API key created for existing load test setup');
            return;
        }
    }

    // Create user
    const hashedPassword = await bcrypt.hash('loadtest123', 10);
    const user = await db
        .insertInto('users')
        .values({
            email: LOAD_TEST_EMAIL,
            password_hash: hashedPassword,
            name: 'Load Test User',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    console.error(`  ✓ User created: ${user.email}`);

    // Create organization
    const organization = await db
        .insertInto('organizations')
        .values({
            name: 'Load Test Organization',
            slug: LOAD_TEST_ORG_SLUG,
            owner_id: user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    console.error(`  ✓ Organization created: ${organization.name}`);

    // Add user to organization
    await db
        .insertInto('organization_members')
        .values({
            user_id: user.id,
            organization_id: organization.id,
            role: 'owner',
        })
        .execute();

    // Create project
    const project = await db
        .insertInto('projects')
        .values({
            name: 'Load Test Project',
            organization_id: organization.id,
            user_id: user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    console.error(`  ✓ Project created: ${project.name}`);

    // Create API key
    const key = `lp_load_${crypto.randomBytes(16).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');

    await db
        .insertInto('api_keys')
        .values({
            project_id: project.id,
            name: 'Load Test API Key',
            key_hash: keyHash,
            last_used: null,
        })
        .execute();

    console.error(`  ✓ API key created`);

    // Output only the API key to stdout (for scripts to capture)
    console.log(key);

    console.error('✅ Load test data seeded successfully!');
}

// Run if called directly
seedLoadTestData()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Failed to seed load test data:', err);
        process.exit(1);
    });
