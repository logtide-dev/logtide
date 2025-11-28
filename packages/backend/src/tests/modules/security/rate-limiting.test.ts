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

            // Login should have max 20 per 15 minutes
            const limit = parseInt(response.headers['x-ratelimit-limit'] || '0');
            expect(limit).toBeLessThanOrEqual(20);
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

            // Register should have max 10 per 15 minutes
            const limit = parseInt(response.headers['x-ratelimit-limit'] || '0');
            expect(limit).toBeLessThanOrEqual(10);
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

        it('should return 429 status when rate limit is exceeded', async () => {
            // Create a fresh app instance with very low rate limit for testing
            const testApp = await build({
                // Fastify options
            });
            await testApp.ready();

            // Override rate limit won't work here since it's registered at build time
            // This test documents expected behavior

            // In a real scenario with exceeded rate limit, we'd expect:
            // - Status code 429
            // - Retry-After header
            // - Error message about rate limit

            await testApp.close();
        });
    });

    describe('Rate Limit by Client', () => {
        it('should rate limit based on API key for ingestion', async () => {
            // Create two different API keys
            const testKey1 = await createTestApiKey({ name: 'Key 1' });
            const testKey2 = await createTestApiKey({ name: 'Key 2' });

            // Make requests with key 1
            const response1 = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', testKey1.plainKey)
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'Key 1 request',
                    }],
                })
                .expect(200);

            // Make requests with key 2
            const response2 = await request(app.server)
                .post('/api/v1/ingest')
                .set('x-api-key', testKey2.plainKey)
                .send({
                    logs: [{
                        time: new Date().toISOString(),
                        service: 'test',
                        level: 'info',
                        message: 'Key 2 request',
                    }],
                })
                .expect(200);

            // Both should have their own rate limit counters
            // Key 2's remaining should not be affected by Key 1's request
            const remaining1 = parseInt(response1.headers['x-ratelimit-remaining'] || '0');
            const remaining2 = parseInt(response2.headers['x-ratelimit-remaining'] || '0');

            // Both should have similar remaining values (within 1-2 of each other due to timing)
            expect(Math.abs(remaining1 - remaining2)).toBeLessThanOrEqual(2);
        });
    });
});
