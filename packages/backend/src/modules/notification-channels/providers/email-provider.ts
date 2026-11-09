/**
 * Email Notification Provider
 * Sends notifications via SMTP using nodemailer
 */

import nodemailer, { type Transporter, type TransportOptions } from 'nodemailer';
import { config } from '../../../config/index.js';
import type { NotificationProvider, NotificationContext, DeliveryResult } from './interface.js';
import type { EmailChannelConfig, ChannelConfig } from '@logtide/shared';
import { getFrontendUrl } from '../../../lib/email/util.js';
import { renderEmail } from '../../../lib/email/layout.js';
import * as ui from '../../../lib/email/components.js';
import { severityTone, type Severity } from '../../../lib/email/tokens.js';

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
    return renderChannelEmail(context);
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

}

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  informational: 'Info',
};

/** HTML of a notification sent through an email channel (and of its test message). */
export function renderChannelEmail(context: NotificationContext): string {
  const link = context.link ? `${getFrontendUrl()}${context.link}` : getFrontendUrl();
  const severity = context.severity as Severity | undefined;
  return renderEmail({
    title: context.title,
    preheader: context.message,
    context: context.organizationName,
    body:
      (severity ? ui.pill(SEVERITY_LABELS[severity] ?? severity, severityTone(severity)) : '') +
      ui.title(context.title) +
      ui.paragraph(context.message, { preWrap: true }) +
      ui.logBlock([{ key: 'event', value: context.eventType }]) +
      ui.button('View details', link),
    footer: { kind: 'notifications' },
  });
}
