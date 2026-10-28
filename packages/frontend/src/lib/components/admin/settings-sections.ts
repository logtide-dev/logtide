import type { InstanceSettingsForm } from '$lib/utils/admin-settings';

export type SettingsSectionKey = 'signups' | 'auth' | 'updates';

/** Which form fields belong to which section (one Save per section). */
const SECTION_FIELDS: Record<SettingsSectionKey, Array<keyof InstanceSettingsForm>> = {
  signups: ['signupEnabled'],
  auth: ['authMode', 'defaultUserId'],
  updates: ['updatesChannel'],
};

/** True when any field of the section differs from the saved form. */
export function isSectionDirty(
  section: SettingsSectionKey,
  saved: InstanceSettingsForm,
  current: InstanceSettingsForm,
): boolean {
  return SECTION_FIELDS[section].some((f) => saved[f] !== current[f]);
}

/** PATCH body with only the keys of one section. */
export function sectionPayload(
  section: SettingsSectionKey,
  form: InstanceSettingsForm,
): Record<string, unknown> {
  switch (section) {
    case 'signups':
      return { 'auth.signup_enabled': form.signupEnabled };
    case 'auth':
      return { 'auth.mode': form.authMode, 'auth.default_user_id': form.defaultUserId };
    case 'updates':
      return { 'updates.channel': form.updatesChannel };
  }
}

/** Auth-free mode is being switched on (needs a confirmation). */
export function isEnablingAuthFree(saved: InstanceSettingsForm, current: InstanceSettingsForm): boolean {
  return saved.authMode !== 'none' && current.authMode === 'none';
}

/** Copy the saved values of one section into the form (discard edits). */
export function resetSection(
  section: SettingsSectionKey,
  saved: InstanceSettingsForm,
  current: InstanceSettingsForm,
): InstanceSettingsForm {
  const next = { ...current };
  for (const f of SECTION_FIELDS[section]) {
    (next as Record<string, unknown>)[f] = saved[f];
  }
  return next;
}
