import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { build } from '../../../server.js';
import { db } from '../../../database/index.js';
import { createTestApiKey, createTestUser } from '../../helpers/factories.js';
import { config } from '../../../config/index.js';

describe('Rate Limiting', () => {
    let app: any;

    beforeAll(async () => {
        app = await build();
        await app.ready();
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    describe('Rate Limit Headers', () => {
        it('should include rate limit headers in response', async () => {
            const response = await request(app.server)
                .get('/health')
                .expect(200);

            // Check for standard rate limit headers
            expect(response.headers).toHaveProperty('x-ratelimit-limit');
            expect(response.headers).toHaveProperty('x-ratelimit-remaining');
        });

        it('should include rate limit headers on ingestion endpoint', async () => {
            const testKey = await createTestApiKey({ name: 'Rate Limit Test Key' });

            const response = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', testKey.plainKey)
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'Rate limit test',
                    }],
                })
                .expect(200);

            expect(response.headers).toHaveProperty('x-ratelimit-limit');
            expect(response.headers).toHaveProperty('x-ratelimit-remaining');
        });
    });

    describe('Auth Endpoint Rate Limiting', () => {
        it('should have lower rate limit for login endpoint', async () => {
            // Make a login request and check the rate limit value
            const response = await request(app.server)
                .post('/api/v1/auth/login')
                .send({
                    email: 'nonexistent@example.com',
                    password: 'wrongpassword',
                });

            // Login should have configured rate limit (can be higher in test env)
            const limit = parseInt(response.headers['x-ratelimit-limit'] || '0');
            // Check that rate limit is set and matches config value
            expect(limit).toBe(config.AUTH_RATE_LIMIT_LOGIN);
        });

        it('should have lower rate limit for register endpoint', async () => {
            // Make a register request with invalid data
            const response = await request(app.server)
                .post('/api/v1/auth/register')
                .send({
                    email: 'invalid-email',
                    password: 'short',
                    name: '',
                });

            // Register should have configured rate limit (can be higher in test env)
            const limit = parseInt(response.headers['x-ratelimit-limit'] || '0');
            // Check that rate limit is set and matches config value
            expect(limit).toBe(config.AUTH_RATE_LIMIT_REGISTER);
        });
    });

    describe('Ingestion Rate Limiting', () => {
        it('should enforce rate limit on batch ingestion endpoint', async () => {
            const testKey = await createTestApiKey({ name: 'Batch Rate Limit Key' });

            // Check the rate limit value
            const response = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', testKey.plainKey)
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'Rate limit test',
                    }],
                })
                .expect(200);

            // Batch ingestion should use configured rate limit
            const limit = parseInt(response.headers['x-ratelimit-limit'] || '0');
            expect(limit).toBe(config.RATE_LIMIT_MAX);
        });

        it('should enforce rate limit on single ingestion endpoint', async () => {
            const testKey = await createTestApiKey({ name: 'Single Rate Limit Key' });

            const response = await request(app.server)
                .post('/api/v1/ingest/single')
                .set('x-api-key', testKey.plainKey)
                .send({
                    time: new Date().toISOString(),
                    service: 'test',
                    level: 'info',
                    message: 'Single log rate limit test',
                })
                .expect(200);

            // Single ingestion should use configured rate limit
            const limit = parseInt(response.headers['x-ratelimit-limit'] || '0');
            expect(limit).toBe(config.RATE_LIMIT_MAX);
        });

        it('should decrement remaining requests counter', async () => {
            const testKey = await createTestApiKey({ name: 'Counter Test Key' });

            // First request
            const response1 = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', testKey.plainKey)
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'First request',
                    }],
                })
                .expect(200);

            const remaining1 = parseInt(response1.headers['x-ratelimit-remaining'] || '0');

            // Second request
            const response2 = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', testKey.plainKey)
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'Second request',
                    }],
                })
                .expect(200);

            const remaining2 = parseInt(response2.headers['x-ratelimit-remaining'] || '0');

            // Remaining should decrease
            expect(remaining2).toBeLessThan(remaining1);
        });
    });

    describe('Rate Limit Exceeded', () => {
        // Note: Testing actual rate limit exceeded requires making many requests
        // which would slow down tests significantly. The tests above verify
        // that rate limiting is configured. For full rate limit testing,
        // use load testing tools (k6, etc.)

        it('should return 429 with Retry-After once a key exceeds the limit', async () => {
            const limited = await buildWithLimit(3);
            try {
                const key = await createTestApiKey({ name: 'Limited key' });
                const statuses: number[] = [];
                let last: request.Response | undefined;
                for (let i = 0; i < 4; i++) {
                    last = await ingestOne(limited, key.plainKey, `burst ${i}`);
                    statuses.push(last.status);
                }
                expect(statuses).toEqual([200, 200, 200, 429]);
                expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
                expect(last!.headers['x-ratelimit-remaining']).toBe('0');
            } finally {
                await limited.close();
            }
        });
    });

    describe('Rate Limit by Client', () => {
        it('counts each API key separately', async () => {
            const limited = await buildWithLimit(2);
            try {
                const key1 = await createTestApiKey({ name: 'Key 1' });
                const key2 = await createTestApiKey({ name: 'Key 2' });
                // Key 1 uses up its limit...
                expect((await ingestOne(limited, key1.plainKey, 'k1 a')).status).toBe(200);
                expect((await ingestOne(limited, key1.plainKey, 'k1 b')).status).toBe(200);
                expect((await ingestOne(limited, key1.plainKey, 'k1 c')).status).toBe(429);
                // ...and key 2 still has all of its own.
                const first = await ingestOne(limited, key2.plainKey, 'k2 a');
                expect(first.status).toBe(200);
                expect(first.headers['x-ratelimit-remaining']).toBe('1');
            } finally {
                await limited.close();
            }
        });
    });
});

/** An app whose rate limits are `max` requests per window (read from config when the routes register). */
async function buildWithLimit(max: number) {
    const original = config.RATE_LIMIT_MAX;
    (config as { RATE_LIMIT_MAX: number }).RATE_LIMIT_MAX = max;
    try {
        const limited = await build();
        await limited.ready();
        return limited;
    } finally {
        (config as { RATE_LIMIT_MAX: number }).RATE_LIMIT_MAX = original;
    }
}

function ingestOne(target: Awaited<ReturnType<typeof build>>, apiKey: string, message: string) {
    return request(target.server)
        .post('/api/v1/ingest')
        .set('x-api-key', apiKey)
        .send({ logs: [{ time: new Date().toISOString(), service: 'test', level: 'info', message }] });
}
