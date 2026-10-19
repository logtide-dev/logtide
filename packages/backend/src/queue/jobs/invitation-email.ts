import nodemailer, { type Transporter, type TransportOptions } from 'nodemailer';
import { config } from '../../config/index.js';
import { generateInvitationEmail } from '../../lib/email-templates.js';

export interface InvitationEmailData {
  email: string;
  token: string;
  organizationId: string;
  organizationName: string;
  inviterName: string;
  role: string;
}

// Create email transporter (reused across notifications)
let emailTransporter: Transporter | null = null;

function getEmailTransporter() {
  if (!emailTransporter) {
    // Check if SMTP is configured
    if (!config.SMTP_HOST) {
      console.warn('SMTP not configured - invitation emails disabled');
      return null;
    }

    const transportOpts: Record<string, unknown> = {
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

    emailTransporter = nodemailer.createTransport(transportOpts as TransportOptions);

    console.log(`Email transporter configured: ${config.SMTP_HOST}:${config.SMTP_PORT}`);
  }

  return emailTransporter;
}

export async function processInvitationEmail(job: any) {
  const data: InvitationEmailData = job.data;

  console.log(`Processing invitation email for: ${data.email}`);

  try {
    await sendInvitationEmail(data);
    console.log(`Invitation email sent to: ${data.email}`);
  } catch (error) {
    console.error(`Failed to send invitation email to ${data.email}:`, error);
    throw error;
  }
}

async function sendInvitationEmail(data: InvitationEmailData) {
  const transporter = getEmailTransporter();

  if (!transporter) {
    throw new Error('Email transporter not configured');
  }

  const { html, text } = generateInvitationEmail({
    email: data.email,
    token: data.token,
    organizationName: data.organizationName,
    inviterName: data.inviterName,
    role: data.role,
  });

  const subject = `Join ${data.organizationName} on LogTide`;

  await transporter.sendMail({
    from: `"LogTide" <${config.SMTP_FROM || config.SMTP_USER}>`,
    to: data.email,
    subject,
    text,
    html,
  });
}

// Queue and worker setup
import { createQueue, createWorker } from '../connection.js';

export const invitationEmailQueue = createQueue<InvitationEmailData>('invitation-email');

export function startInvitationEmailWorker() {
  const worker = createWorker<InvitationEmailData>('invitation-email', processInvitationEmail);

  worker.on('completed', (job) => {
    console.log(`Invitation email job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Invitation email job ${job?.id} failed:`, err);
  });

  console.log('Invitation email worker started');

  return worker;
}
