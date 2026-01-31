import { describe, it, expect } from 'vitest';
import { configSchema, formatConfigError } from '../../config/index.js';

describe('Config Validation', () => {
  describe('configSchema', () => {
    it('should require DATABASE_URL', () => {
      const result = configSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.DATABASE_URL).toBeDefined();
      }
    });

    it('should require API_KEY_SECRET with minimum 32 characters', () => {
      const result = configSchema.safeParse({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        API_KEY_SECRET: 'short', // Too short
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.API_KEY_SECRET).toBeDefined();
      }
    });

    it('should accept valid API_KEY_SECRET with 32+ characters', () => {
      const result = configSchema.safeParse({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        API_KEY_SECRET: 'a'.repeat(32), // Exactly 32 characters
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid API_KEY_SECRET with 44 characters (base64)', () => {
      const result = configSchema.safeParse({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        API_KEY_SECRET: 'b+05tYherr5DXdc95NNc079GgdZnv+rN08EXP96C8PI=', // 44 chars from openssl
      });
      expect(result.success).toBe(true);
    });

    it('should use default values for optional fields', () => {
      const result = configSchema.safeParse({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        API_KEY_SECRET: 'a'.repeat(32),
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORT).toBe(8080);
        expect(result.data.HOST).toBe('0.0.0.0');
        expect(result.data.NODE_ENV).toBe('development');
        // REDIS_URL is optional without default - when not provided, system uses PostgreSQL-based queue
        expect(result.data.REDIS_URL).toBeUndefined();
      }
    });

    it('should validate DATABASE_URL is a valid URL', () => {
      const result = configSchema.safeParse({
        DATABASE_URL: 'not-a-url',
        API_KEY_SECRET: 'a'.repeat(32),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.DATABASE_URL).toBeDefined();
      }
    });

    it('should accept custom PORT and HOST', () => {
      const result = configSchema.safeParse({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        API_KEY_SECRET: 'a'.repeat(32),
        PORT: '3000',
        HOST: '127.0.0.1',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORT).toBe(3000);
        expect(result.data.HOST).toBe('127.0.0.1');
      }
    });

    it('should accept INITIAL_ADMIN configuration', () => {
      const result = configSchema.safeParse({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        API_KEY_SECRET: 'a'.repeat(32),
        INITIAL_ADMIN_EMAIL: 'admin@example.com',
        INITIAL_ADMIN_PASSWORD: 'securepassword123',
        INITIAL_ADMIN_NAME: 'Admin User',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.INITIAL_ADMIN_EMAIL).toBe('admin@example.com');
        expect(result.data.INITIAL_ADMIN_PASSWORD).toBe('securepassword123');
        expect(result.data.INITIAL_ADMIN_NAME).toBe('Admin User');
      }
    });

    it('should require INITIAL_ADMIN_PASSWORD to be at least 8 characters', () => {
      const result = configSchema.safeParse({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        API_KEY_SECRET: 'a'.repeat(32),
        INITIAL_ADMIN_EMAIL: 'admin@example.com',
        INITIAL_ADMIN_PASSWORD: 'short', // Too short
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.INITIAL_ADMIN_PASSWORD).toBeDefined();
      }
    });
  });

  describe('formatConfigError', () => {
    it('should format error with header and footer', () => {
      const result = configSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const formatted = formatConfigError(result.error);
        expect(formatted).toContain('CONFIGURATION ERROR');
        expect(formatted).toContain('Backend cannot start');
        expect(formatted).toContain('Please check your .env file');
      }
    });

    it('should include hint for API_KEY_SECRET error', () => {
      const result = configSchema.safeParse({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        API_KEY_SECRET: 'short',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const formatted = formatConfigError(result.error);
        expect(formatted).toContain('API_KEY_SECRET');
        expect(formatted).toContain('at least 32 characters');
        expect(formatted).toContain('openssl rand -base64 32');
      }
    });

    it('should include hint for DATABASE_URL error', () => {
      const result = configSchema.safeParse({
        API_KEY_SECRET: 'a'.repeat(32),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const formatted = formatConfigError(result.error);
        expect(formatted).toContain('DATABASE_URL');
        expect(formatted).toContain('DB_USER, DB_PASSWORD, and DB_NAME');
      }
    });

    it('should list all field errors', () => {
      const result = configSchema.safeParse({
        DATABASE_URL: 'not-a-url',
        API_KEY_SECRET: 'short',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const formatted = formatConfigError(result.error);
        expect(formatted).toContain('DATABASE_URL');
        expect(formatted).toContain('API_KEY_SECRET');
      }
    });
  });
});
