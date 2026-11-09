import { describe, it, expect } from 'vitest';
import {
  generateInvitationEmail,
  generateEmailVerificationEmail,
  generatePasswordResetEmail,
} from '../../lib/email-templates.js';

const SETTINGS_LINK = '/dashboard/settings/notifications/destinations';

describe('console account emails', () => {
  it('password reset: button, raw link, single use, no notification settings link', () => {
    const { html } = generatePasswordResetEmail({ name: 'Alex', token: 'tok/+=' });
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('Reset password');
    expect(html).toContain('If the button does not work');
    expect(html).toContain('/reset-password?token=tok%2F%2B%3D');
    expect(html).toContain('can be used once');
    expect(html).toContain('If you did not ask for this');
    expect(html).not.toContain(SETTINGS_LINK);
  });

  it('email verification: raw link and no notification settings link', () => {
    const { html } = generateEmailVerificationEmail({ name: 'Alex', token: 'abc' });
    expect(html).toContain('Verify email');
    expect(html).toContain('If the button does not work');
    expect(html).toContain('/verify-email?token=abc');
    expect(html).toContain('expires in 24 hours');
    expect(html).not.toContain(SETTINGS_LINK);
  });

  it('invitation: role, expiry, raw link and no notification settings link', () => {
    const { html } = generateInvitationEmail({
      email: 'new@northwind.example',
      token: 'inv1',
      organizationName: 'Northwind <Ops>',
      inviterName: 'Alex',
      role: 'admin',
    });
    expect(html).toContain('Accept invitation');
    expect(html).toContain('/invite/inv1');
    expect(html).toContain('If the button does not work');
    expect(html).toContain('Admin');
    expect(html).toContain('expires in 7 days');
    expect(html).toContain('Northwind &lt;Ops&gt;');
    expect(html).not.toContain('Northwind <Ops>');
    expect(html).not.toContain(SETTINGS_LINK);
  });
});
