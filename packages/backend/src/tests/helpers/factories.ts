import { db } from '../../database/index.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

/**
 * Factory for creating test users
 */
export async function createTestUser(overrides: {
    email?: string;
    password?: string;
    name?: string;
} = {}) {
    const email = overrides.email || `test-${Date.now()}@example.com`;
    const password = overrides.password || 'password123';
    const name = overrides.name || 'Test User';

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await db
        .insertInto('users')
        .values({
            email,
            password_hash: hashedPassword,
            name,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    return { ...user, plainPassword: password };
}

/**
 * Factory for creating test organizations
 */
export async function createTestOrganization(overrides: {
    name?: string;
    slug?: string;
    ownerId?: string;
} = {}) {
    const name = overrides.name || `Test Org ${Date.now()}`;
    const slug = overrides.slug || `test-org-${Date.now()}`;

    // Create owner if not provided
    let ownerId = overrides.ownerId;
    if (!ownerId) {
        const owner = await createTestUser();
        ownerId = owner.id;
    }

    const organization = await db
        .insertInto('organizations')
        .values({
            name,
            slug,
            owner_id: ownerId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    // Add owner to organization
    await db
        .insertInto('organization_members')
        .values({
            user_id: ownerId,
            organization_id: organization.id,
            role: 'owner',
        })
        .execute();

    return organization;
}

/**
 * Factory for creating test projects
 */
export async function createTestProject(overrides: {
    name?: string;
    organizationId?: string;
    userId?: string;
} = {}) {
    const name = overrides.name || `Test Project ${Date.now()}`;

    // Create organization if not provided
    let organizationId = overrides.organizationId;
    let userId = overrides.userId;

    if (!organizationId) {
        const org = await createTestOrganization();
        organizationId = org.id;
        userId = org.owner_id;
    } else if (!userId) {
        // If org is provided but not user, get the org owner
        const org = await db
            .selectFrom('organizations')
            .select('owner_id')
            .where('id', '=', organizationId)
            .executeTakeFirstOrThrow();
        userId = org.owner_id;
    }

    const project = await db
        .insertInto('projects')
        .values({
            name,
            organization_id: organizationId,
            user_id: userId!,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    return project;
}

/**
 * Factory for creating test API keys
 */
export async function createTestApiKey(overrides: {
    projectId?: string;
    name?: string;
} = {}) {
    // Create project if not provided
    let projectId = overrides.projectId;
    if (!projectId) {
        const project = await createTestProject();
        projectId = project.id;
    }

    const name = overrides.name || 'Test API Key';
    const key = `lp_test_${crypto.randomBytes(16).toString('hex')}`;

    // Hash API key using SHA-256 (same as apiKeysService.verifyApiKey)
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');

    const apiKey = await db
        .insertInto('api_keys')
        .values({
            project_id: projectId,
            name,
            key_hash: keyHash,
            last_used: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    return { ...apiKey, plainKey: key };
}

/**
 * Factory for creating test logs
 */
export async function createTestLog(overrides: {
    projectId?: string;
    service?: string;
    level?: 'debug' | 'info' | 'warn' | 'error' | 'critical';
    message?: string;
    metadata?: any;
    trace_id?: string;
    time?: Date;
} = {}) {
    // Create project if not provided
    let projectId = overrides.projectId;
    if (!projectId) {
        const project = await createTestProject();
        projectId = project.id;
    }

    const log = await db
        .insertInto('logs')
        .values({
            project_id: projectId,
            service: overrides.service || 'test-service',
            level: overrides.level || 'info',
            message: overrides.message || 'Test log message',
            metadata: overrides.metadata || null,
            trace_id: overrides.trace_id || null,
            time: overrides.time || new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    return log;
}

/**
 * Factory for creating test Sigma rules
 */
export async function createTestSigmaRule(overrides: {
    organizationId?: string;
    projectId?: string | null;
    title?: string;
    description?: string;
    level?: string;
    enabled?: boolean;
    logsource?: any;
    detection?: any;
    emailRecipients?: string[];
    webhookUrl?: string;
    sigmaId?: string;
} = {}) {
    // Create organization if not provided
    let organizationId = overrides.organizationId;
    if (!organizationId) {
        const org = await createTestOrganization();
        organizationId = org.id;
    }

    const title = overrides.title || `Test Sigma Rule ${Date.now()}`;
    const level = overrides.level || 'medium';
    const sigmaId = overrides.sigmaId || `sigma-${crypto.randomUUID()}`;

    const sigmaRule = await db
        .insertInto('sigma_rules')
        .values({
            organization_id: organizationId,
            project_id: overrides.projectId || null,
            sigma_id: sigmaId,
            title,
            description: overrides.description || 'Test sigma rule',
            level,
            status: 'stable',
            logsource: overrides.logsource || {
                product: 'linux',
            },
            detection: overrides.detection || {
                selection: {
                    'message|contains': 'test',
                },
                condition: 'selection',
            },
            email_recipients: overrides.emailRecipients || [],
            webhook_url: overrides.webhookUrl || null,
            alert_rule_id: null,
            conversion_status: 'success',
            conversion_notes: 'Test rule created by factory',
            tags: [],
            mitre_tactics: null,
            mitre_techniques: null,
            sigmahq_path: null,
            sigmahq_commit: null,
            last_synced_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    return sigmaRule;
}

/**
 * Factory for creating test alert rules
 */
export async function createTestAlertRule(overrides: {
    organizationId?: string;
    projectId?: string | null;
    name?: string;
    timeWindow?: number;
    threshold?: number;
    enabled?: boolean;
} = {}) {
    // Create organization if not provided
    let organizationId = overrides.organizationId;
    if (!organizationId) {
        const org = await createTestOrganization();
        organizationId = org.id;
    }

    const alertRule = await db
        .insertInto('alert_rules')
        .values({
            organization_id: organizationId,
            project_id: overrides.projectId || null,
            name: overrides.name || 'Test Alert Rule',
            service: null,
            level: ['error'],
            time_window: overrides.timeWindow || 5,
            threshold: overrides.threshold || 10,
            enabled: overrides.enabled ?? true,
            email_recipients: [],
            webhook_url: null,
            metadata: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    return alertRule;
}

/**
 * Create a complete test context with user, org, project, and API key
 */
export async function createTestContext() {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerId: user.id });
    const project = await createTestProject({ organizationId: organization.id, userId: user.id });
    const apiKey = await createTestApiKey({ projectId: project.id });

    return {
        user,
        organization,
        project,
        apiKey,
    };
}

/**
 * Factory for creating test spans
 */
export async function createTestSpan(overrides: {
    projectId?: string;
    organizationId?: string;
    traceId?: string;
    spanId?: string;
    parentSpanId?: string | null;
    serviceName?: string;
    operationName?: string;
    startTime?: Date;
    endTime?: Date;
    durationMs?: number;
    kind?: 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';
    statusCode?: 'UNSET' | 'OK' | 'ERROR';
    statusMessage?: string | null;
    attributes?: Record<string, unknown> | null;
    events?: Record<string, unknown>[] | null;
    links?: Record<string, unknown>[] | null;
    resourceAttributes?: Record<string, unknown> | null;
} = {}) {
    // Create project if not provided
    let projectId = overrides.projectId;
    let organizationId = overrides.organizationId;

    if (!projectId) {
        const project = await createTestProject();
        projectId = project.id;
        const org = await db
            .selectFrom('organizations')
            .select('id')
            .where('id', '=', project.organization_id)
            .executeTakeFirstOrThrow();
        organizationId = org.id;
    } else if (!organizationId) {
        const project = await db
            .selectFrom('projects')
            .select('organization_id')
            .where('id', '=', projectId)
            .executeTakeFirstOrThrow();
        organizationId = project.organization_id;
    }

    const now = new Date();
    const startTime = overrides.startTime || now;
    const durationMs = overrides.durationMs || 100;
    const endTime = overrides.endTime || new Date(startTime.getTime() + durationMs);

    const traceId = overrides.traceId || crypto.randomBytes(16).toString('hex');
    const spanId = overrides.spanId || crypto.randomBytes(8).toString('hex');

    // Use raw SQL for JSONB fields to ensure proper serialization
    const { sql } = await import('kysely');

    const attributesJson = overrides.attributes ? JSON.stringify(overrides.attributes) : null;
    const eventsJson = overrides.events ? JSON.stringify(overrides.events) : null;
    const linksJson = overrides.links ? JSON.stringify(overrides.links) : null;
    const resourceAttributesJson = overrides.resourceAttributes ? JSON.stringify(overrides.resourceAttributes) : null;

    const result = await sql`
        INSERT INTO spans (
            time, project_id, organization_id, trace_id, span_id, parent_span_id,
            service_name, operation_name, start_time, end_time, duration_ms,
            kind, status_code, status_message, attributes, events, links, resource_attributes
        ) VALUES (
            ${startTime},
            ${projectId},
            ${organizationId!},
            ${traceId},
            ${spanId},
            ${overrides.parentSpanId ?? null},
            ${overrides.serviceName || 'test-service'},
            ${overrides.operationName || 'test-operation'},
            ${startTime},
            ${endTime},
            ${durationMs},
            ${overrides.kind || null},
            ${overrides.statusCode || null},
            ${overrides.statusMessage ?? null},
            ${attributesJson}::jsonb,
            ${eventsJson}::jsonb,
            ${linksJson}::jsonb,
            ${resourceAttributesJson}::jsonb
        )
        RETURNING *
    `.execute(db);

    const span = result.rows[0] as any;

    return span;
}

/**
 * Factory for creating test traces
 */
export async function createTestTrace(overrides: {
    projectId?: string;
    organizationId?: string;
    traceId?: string;
    serviceName?: string;
    rootServiceName?: string | null;
    rootOperationName?: string | null;
    startTime?: Date;
    endTime?: Date;
    durationMs?: number;
    spanCount?: number;
    error?: boolean;
} = {}) {
    // Create project if not provided
    let projectId = overrides.projectId;
    let organizationId = overrides.organizationId;

    if (!projectId) {
        const project = await createTestProject();
        projectId = project.id;
        const org = await db
            .selectFrom('organizations')
            .select('id')
            .where('id', '=', project.organization_id)
            .executeTakeFirstOrThrow();
        organizationId = org.id;
    } else if (!organizationId) {
        const project = await db
            .selectFrom('projects')
            .select('organization_id')
            .where('id', '=', projectId)
            .executeTakeFirstOrThrow();
        organizationId = project.organization_id;
    }

    const now = new Date();
    const startTime = overrides.startTime || now;
    const durationMs = overrides.durationMs || 100;
    const endTime = overrides.endTime || new Date(startTime.getTime() + durationMs);

    const traceId = overrides.traceId || crypto.randomBytes(16).toString('hex');
    const serviceName = overrides.serviceName || 'test-service';

    const trace = await db
        .insertInto('traces')
        .values({
            project_id: projectId,
            organization_id: organizationId!,
            trace_id: traceId,
            service_name: serviceName,
            root_service_name: overrides.rootServiceName ?? serviceName,
            root_operation_name: overrides.rootOperationName ?? 'root-operation',
            start_time: startTime,
            end_time: endTime,
            duration_ms: durationMs,
            span_count: overrides.spanCount || 1,
            error: overrides.error || false,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    return trace;
}
