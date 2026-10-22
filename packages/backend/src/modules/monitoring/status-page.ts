import type { Kysely } from 'kysely';
import { z } from 'zod';
import { db as defaultDb } from '../../database/index.js';
import type { Database } from '../../database/types.js';

/**
 * Per-project status page facts: branding (status_page_config, one row per
 * project, an absent row means defaults) and the public components (display
 * name, group and order live as columns on the monitors themselves).
 */

export interface StatusPageConfig {
  title: string | null;
  description: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  showMonitorTypes: boolean;
}

export const DEFAULT_STATUS_PAGE_CONFIG: StatusPageConfig = {
  title: null,
  description: null,
  logoUrl: null,
  accentColor: null,
  showMonitorTypes: false,
};

const logoUrlSchema = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'logoUrl must be an https URL without credentials');

/** Every field is optional: omitted keeps the stored value, null clears it. */
export const statusPageConfigSchema = z.object({
  title: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  logoUrl: logoUrlSchema.nullable().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'accentColor must be a #rrggbb colour')
    .nullable()
    .optional(),
  showMonitorTypes: z.boolean().optional(),
});

export type StatusPageConfigInput = z.infer<typeof statusPageConfigSchema>;

export const componentsSchema = z
  .array(
    z.object({
      monitorId: z.string().uuid(),
      displayName: z.string().trim().min(1).max(255).nullable(),
      groupName: z.string().trim().min(1).max(100).nullable(),
      order: z.number().int().min(0).max(100000),
    })
  )
  .max(500)
  .refine((list) => new Set(list.map((c) => c.monitorId)).size === list.length, 'Duplicate monitorId');

export type ComponentInput = z.infer<typeof componentsSchema>[number];

/** Raised when a component references a monitor outside the project. */
export class ComponentsValidationError extends Error {}

function mapConfig(row: {
  title: string | null;
  description: string | null;
  logo_url: string | null;
  accent_color: string | null;
  show_monitor_types: boolean;
}): StatusPageConfig {
  return {
    title: row.title,
    description: row.description,
    logoUrl: row.logo_url,
    accentColor: row.accent_color,
    showMonitorTypes: row.show_monitor_types,
  };
}

export class StatusPageService {
  constructor(private db: Kysely<Database> = defaultDb) {}

  async getConfig(projectId: string, organizationId: string): Promise<StatusPageConfig> {
    const row = await this.db
      .selectFrom('status_page_config')
      .select(['title', 'description', 'logo_url', 'accent_color', 'show_monitor_types'])
      .where('project_id', '=', projectId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    return row ? mapConfig(row) : { ...DEFAULT_STATUS_PAGE_CONFIG };
  }

  async upsertConfig(
    projectId: string,
    organizationId: string,
    input: StatusPageConfigInput
  ): Promise<StatusPageConfig> {
    const current = await this.getConfig(projectId, organizationId);
    const next: StatusPageConfig = {
      title: input.title === undefined ? current.title : input.title || null,
      description: input.description === undefined ? current.description : input.description || null,
      logoUrl: input.logoUrl === undefined ? current.logoUrl : input.logoUrl,
      accentColor: input.accentColor === undefined ? current.accentColor : input.accentColor,
      showMonitorTypes: input.showMonitorTypes ?? current.showMonitorTypes,
    };

    const values = {
      title: next.title,
      description: next.description,
      logo_url: next.logoUrl,
      accent_color: next.accentColor,
      show_monitor_types: next.showMonitorTypes,
    };

    const row = await this.db
      .insertInto('status_page_config')
      .values({ project_id: projectId, organization_id: organizationId, ...values })
      .onConflict((oc) =>
        oc
          .column('project_id')
          .doUpdateSet({ ...values, updated_at: new Date() })
          .where('status_page_config.organization_id', '=', organizationId)
      )
      .returning(['title', 'description', 'logo_url', 'accent_color', 'show_monitor_types'])
      .executeTakeFirstOrThrow();
    return mapConfig(row);
  }

  /**
   * Replaces display name, group and order of the listed monitors in one
   * transaction. Every monitor must belong to the project and organization,
   * otherwise nothing changes and ComponentsValidationError is thrown.
   */
  async updateComponents(
    projectId: string,
    organizationId: string,
    components: ComponentInput[]
  ): Promise<void> {
    if (components.length === 0) return;
    await this.db.transaction().execute(async (trx) => {
      const ids = components.map((c) => c.monitorId);
      const owned = await trx
        .selectFrom('monitors')
        .select('id')
        .where('id', 'in', ids)
        .where('project_id', '=', projectId)
        .where('organization_id', '=', organizationId)
        .execute();
      if (owned.length !== ids.length) {
        throw new ComponentsValidationError('monitorId does not belong to the project');
      }
      for (const c of components) {
        await trx
          .updateTable('monitors')
          .set({ display_name: c.displayName, group_name: c.groupName, display_order: c.order })
          .where('id', '=', c.monitorId)
          .where('project_id', '=', projectId)
          .where('organization_id', '=', organizationId)
          .execute();
      }
    });
  }
}

export const statusPageService = new StatusPageService();
