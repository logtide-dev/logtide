import nodemailer from 'nodemailer';
import { config } from '../config/index.js';

let transporter: nodemailer.Transporter | null = null;

/**
 * Lazily created SMTP transporter for API-process emails that are sent
 * inline (no queue). Returns null when SMTP is not configured.
 */
export function getMailer(): nodemailer.Transporter | null {
  if (!config.SMTP_HOST) return null;
  if (!transporter) {
    const opts: Record<string, unknown> = {
      host: config.SMTP_HOST,
      port: config.SMTP_PORT || 587,
      secure: config.SMTP_SECURE || false,
    };
    if (config.SMTP_USER && config.SMTP_PASS) {
      opts.auth = { user: config.SMTP_USER, pass: config.SMTP_PASS };
    }
    transporter = nodemailer.createTransport(opts as nodemailer.TransportOptions);
  }
  return transporter;
}
