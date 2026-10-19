/**
 * Email Notification Provider
 * Sends notifications via SMTP using nodemailer
 */

import nodemailer, { type Transporter, type TransportOptions } from 'nodemailer';
import { config } from '../../../config/index.js';
import type { NotificationProvider, NotificationContext, DeliveryResult } from './interface.js';
import type { EmailChannelConfig, ChannelConfig } from '@logtide/shared';

export class EmailProvider implements NotificationProvider {
  readonly type = 'email' as const;
  private transporter: Transporter | null = null;

  constructor() {
    if (config.SMTP_HOST) {
      const transportOpts: TransportOptions & { host: string; port: number; secure: boolean; auth?: { user: string; pass: string } } = {
        host: config.SMTP_HOST,
        port: config.SMTP_PORT || 587,
        secure: config.SMTP_SECURE || false,
      };
      if (config.SMTP_USER && config.SMTP_PASS) {
        transportOpts.auth = {
          user: config.SMTP_USER,
          pass: config.SMTP_PASS,
        };
      }
      this.transporter = nodemailer.createTransport(transportOpts);
      console.log(`[EmailProvider] Configured: ${config.SMTP_HOST}:${config.SMTP_PORT}`);
    } else {
      console.warn('[EmailProvider] SMTP not configured - email notifications disabled');
    }
  }

  async send(context: NotificationContext, channelConfig: ChannelConfig): Promise<DeliveryResult> {
    if (!this.transporter) {
      return { success: false, error: 'SMTP not configured' };
    }

    if (!this.validateConfig(channelConfig)) {
      return { success: false, error: 'Invalid email configuration' };
    }

    const emailConfig = channelConfig as EmailChannelConfig;

    try {
      const html = this.generateHtml(context);
      const text = this.generateText(context);
      const subject = this.getSubject(context);

      await this.transporter.sendMail({
        from: `"LogTide Notifications" <${config.SMTP_FROM}>`,
        to: emailConfig.recipients.join(', '),
        subject,
        text,
        html,
      });

      console.log(`[EmailProvider] Sent to ${emailConfig.recipients.length} recipients`);

      return {
        success: true,
        metadata: { recipientCount: emailConfig.recipients.length },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[EmailProvider] Failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  validateConfig(config: unknown): config is EmailChannelConfig {
    const c = config as EmailChannelConfig;
    return (
      typeof c === 'object' &&
      c !== null &&
      Array.isArray(c.recipients) &&
      c.recipients.length > 0 &&
      c.recipients.every((r) => typeof r === 'string' && r.includes('@'))
    );
  }

  async test(channelConfig: ChannelConfig, organizationId: string): Promise<DeliveryResult> {
    return this.send(
      {
        organizationId,
        organizationName: 'Test Organization',
        eventType: 'alert',
        title: 'Test Notification',
        message: 'This is a test notification from LogTide to verify your channel configuration.',
        severity: 'informational',
      },
      channelConfig
    );
  }

  private getSubject(context: NotificationContext): string {
    const severityPrefix =
      context.severity === 'critical' || context.severity === 'high'
        ? `[${context.severity.toUpperCase()}] `
        : '';
    return `${severityPrefix}${context.title}`;
  }

  private generateHtml(context: NotificationContext): string {
    const severityColor = this.getSeverityColor(context.severity);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const link = context.link ? `${frontendUrl}${context.link}` : frontendUrl;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <!-- Header -->
                <tr>
                  <td style="padding: 32px 32px 24px; border-bottom: 1px solid #e4e4e7;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <span style="font-size: 24px; font-weight: 700; color: ${severityColor};">${context.title}</span>
                        </td>
                        ${context.severity ? `
                        <td align="right">
                          <span style="display: inline-block; padding: 6px 12px; background-color: ${severityColor}; color: white; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                            ${context.severity}
                          </span>
                        </td>
                        ` : ''}
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 32px;">
                    <p style="margin: 0 0 24px; font-size: 14px; color: #52525b; line-height: 1.6;">
                      ${context.message}
                    </p>

                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; border-radius: 6px; margin-bottom: 24px;">
                      <tr>
                        <td style="padding: 16px;">
                          <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="padding-bottom: 8px;">
                                <span style="font-size: 12px; color: #71717a;">Organization</span><br>
                                <span style="font-size: 14px; font-weight: 500; color: #18181b;">${context.organizationName}</span>
                              </td>
                            </tr>
                            <tr>
                              <td>
                                <span style="font-size: 12px; color: #71717a;">Event Type</span><br>
                                <span style="font-size: 14px; font-weight: 500; color: #18181b;">${context.eventType}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center">
                          <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #18181b; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 500;">
                            View Details
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 24px 32px; background-color: #f4f4f5; border-radius: 0 0 8px 8px;">
                    <p style="margin: 0; font-size: 12px; color: #71717a; text-align: center;">
                      This is an automated notification from LogTide.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }

  private generateText(context: NotificationContext): string {
    return `
${context.title}
${context.severity ? `Severity: ${context.severity}` : ''}

${context.message}

Organization: ${context.organizationName}
Event Type: ${context.eventType}

This is an automated notification from LogTide.
    `.trim();
  }

  private getSeverityColor(severity?: string): string {
    const colors: Record<string, string> = {
      critical: '#dc2626',
      high: '#ea580c',
      medium: '#ca8a04',
      low: '#2563eb',
      informational: '#6b7280',
    };
    return colors[severity || 'informational'] || '#6b7280';
  }
}
