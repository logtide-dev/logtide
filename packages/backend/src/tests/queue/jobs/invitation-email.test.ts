import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock queue connection BEFORE importing anything that uses it
vi.mock('../../../queue/connection.js', () => ({
  createQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({ id: 'job-id' }),
    close: vi.fn(),
  })),
  createWorker: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
  connection: {
    duplicate: vi.fn(() => ({
      subscribe: vi.fn(),
      on: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
    })),
  },
}));

// Mock the config module first (before any imports)
vi.mock('../../../config/index.js', () => ({
  config: {
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    SMTP_SECURE: false,
    SMTP_USER: 'test@example.com',
    SMTP_PASS: 'password',
    SMTP_FROM: 'noreply@test.com',
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379',
  },
}));

// Mock nodemailer
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-message-id' });
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
}));

// Import after mocks
import { processInvitationEmail, type InvitationEmailData } from '../../../queue/jobs/invitation-email.js';

describe('Invitation Email Job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processInvitationEmail', () => {
    it('should send invitation email with correct data', async () => {
      const emailData: InvitationEmailData = {
        email: 'invited@example.com',
        token: 'test-token-123',
        organizationId: 'org-123',
        organizationName: 'Test Organization',
        inviterName: 'John Doe',
        role: 'member',
      };

      const job = { data: emailData };

      await processInvitationEmail(job);

      // Verify email was sent
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'invited@example.com',
          subject: expect.stringContaining('Test Organization'),
        })
      );
    });

    it('should include inviter name and org name in email', async () => {
      const emailData: InvitationEmailData = {
        email: 'test@example.com',
        token: 'abc123',
        organizationId: 'org-456',
        organizationName: 'Acme Corp',
        inviterName: 'Jane Smith',
        role: 'admin',
      };

      const job = { data: emailData };

      await processInvitationEmail(job);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('Jane Smith'),
        })
      );
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('Acme Corp'),
        })
      );
    });

    it('should include correct invitation URL with token', async () => {
      const emailData: InvitationEmailData = {
        email: 'user@example.com',
        token: 'unique-token-xyz',
        organizationId: 'org-789',
        organizationName: 'Test Org',
        inviterName: 'Tester',
        role: 'member',
      };

      const job = { data: emailData };

      await processInvitationEmail(job);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('/invite/unique-token-xyz'),
        })
      );
    });

    it('should include role in email', async () => {
      const emailData: InvitationEmailData = {
        email: 'admin@example.com',
        token: 'token-for-admin',
        organizationId: 'org-123',
        organizationName: 'Admin Org',
        inviterName: 'Owner',
        role: 'admin',
      };

      const job = { data: emailData };

      await processInvitationEmail(job);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('admin'),
        })
      );
    });

    it('should include both HTML and text versions', async () => {
      const emailData: InvitationEmailData = {
        email: 'multiformat@example.com',
        token: 'token-123',
        organizationId: 'org-123',
        organizationName: 'Test Org',
        inviterName: 'Sender',
        role: 'member',
      };

      const job = { data: emailData };

      await processInvitationEmail(job);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.any(String),
          text: expect.any(String),
        })
      );
    });

    it('should throw error when email sending fails', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('SMTP connection failed'));

      const emailData: InvitationEmailData = {
        email: 'fail@example.com',
        token: 'token-fail',
        organizationId: 'org-fail',
        organizationName: 'Fail Org',
        inviterName: 'Failer',
        role: 'member',
      };

      const job = { data: emailData };

      await expect(processInvitationEmail(job)).rejects.toThrow();
    });
  });

  describe('InvitationEmailData interface', () => {
    it('should accept all required fields', () => {
      const validData: InvitationEmailData = {
        email: 'test@example.com',
        token: 'token123',
        organizationId: 'org-id',
        organizationName: 'Org Name',
        inviterName: 'Inviter',
        role: 'member',
      };

      expect(validData.email).toBe('test@example.com');
      expect(validData.token).toBe('token123');
      expect(validData.organizationId).toBe('org-id');
      expect(validData.organizationName).toBe('Org Name');
      expect(validData.inviterName).toBe('Inviter');
      expect(validData.role).toBe('member');
    });

    it('should handle different roles', () => {
      const roles = ['owner', 'admin', 'member'];

      for (const role of roles) {
        const data: InvitationEmailData = {
          email: 'test@example.com',
          token: 'token',
          organizationId: 'org',
          organizationName: 'Org',
          inviterName: 'Inviter',
          role,
        };

        expect(data.role).toBe(role);
      }
    });
  });
});

describe('Email Template', () => {
  it('should include expiration notice', async () => {
    const emailData: InvitationEmailData = {
      email: 'test@example.com',
      token: 'token',
      organizationId: 'org',
      organizationName: 'Test Org',
      inviterName: 'Inviter',
      role: 'member',
    };

    const job = { data: emailData };

    await processInvitationEmail(job);

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('7 days'),
      })
    );
  });

  it('should include LogTide branding', async () => {
    const emailData: InvitationEmailData = {
      email: 'test@example.com',
      token: 'token',
      organizationId: 'org',
      organizationName: 'Test Org',
      inviterName: 'Inviter',
      role: 'member',
    };

    const job = { data: emailData };

    await processInvitationEmail(job);

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('LogTide'),
      })
    );
  });

  it('should include accept button', async () => {
    const emailData: InvitationEmailData = {
      email: 'test@example.com',
      token: 'token',
      organizationId: 'org',
      organizationName: 'Test Org',
      inviterName: 'Inviter',
      role: 'member',
    };

    const job = { data: emailData };

    await processInvitationEmail(job);

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('Accept Invitation'),
      })
    );
  });
});
