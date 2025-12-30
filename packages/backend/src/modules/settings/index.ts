/**
 * Settings Module
 *
 * Exports settings service and routes for managing system-wide configuration.
 */

export { settingsService, SettingsService, SETTING_KEYS } from './service.js';
export type { AuthMode, SettingRecord, SystemSettings } from './service.js';
export { settingsRoutes, publicSettingsRoutes } from './routes.js';
