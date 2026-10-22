// ============================================================================
// Custom Dashboards Service
// ============================================================================
//
// CRUD + ensureDefaultExists + YAML import/export. All persisted documents
// are migrated to the current schema version on read via migrateDashboard.

import yaml from 'js-yaml';
import { db } from '../../database/index.js';
import {
  CURRENT_SCHEMA_VERSION,
  migrateDashboard,
  type CustomDashboard,
  type DashboardDocument,
  type PanelConfig,
  type PanelInstance,
} from '@logtide/shared';
import {
  dashboardDocumentSchema,
  panelRegistry,
  panelInstanceSchema,
  panelConfigSchema,
} from './panel-registry.js';
import { buildTemplateYaml } from './templates.js';

interface DashboardRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  created_by: string | null;
  name: string;
  description: string | null;
  is_default: boolean;
  is_personal: boolean;
  schema_version: number;
  panels: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface CreateDashboardInput {
  organizationId: string;
  projectId?: string | null;
  name: string;
  description?: string | null;
  isPersonal?: boolean;
  panels?: PanelInstance[];
}

export interface UpdateDashboardInput {
  name?: string;
  description?: string | null;
  isPersonal?: boolean;
  panels?: PanelInstance[];
}

export class CustomDashboardsService {
  private mapRow(row: DashboardRow): CustomDashboard {
    // Defensive: a row could be present at v0 (manual DB edit / earlier bug)
    // or at a future schema_version (rolling deploy). Clamp into the
    // supported range so the read path never crashes.
    const safeVersion = Math.max(
      1,
      Math.min(row.schema_version, CURRENT_SCHEMA_VERSION)
    );
    const rawDoc: DashboardDocument = {
      schema_version: safeVersion,
      panels: this.normalizePanelsField(row.panels),
    };
    const migrated = migrateDashboard(rawDoc, CURRENT_SCHEMA_VERSION);

    return {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      createdBy: row.created_by,
      name: row.name,
      description: row.description,
      isDefault: row.is_default,
      isPersonal: row.is_personal,
      schemaVersion: migrated.schema_version,
      panels: migrated.panels,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private normalizePanelsField(value: unknown): PanelInstance[] {
    if (Array.isArray(value)) return value as PanelInstance[];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Validate every panel in a list against its registered Zod schema. Throws
   * a ZodError on any failure - handlers translate that into HTTP 400.
   */
  private validatePanels(panels: PanelInstance[]): PanelInstance[] {
    return panels.map((p) => panelInstanceSchema.parse(p) as PanelInstance);
  }

  async list(organizationId: string, userId: string, projectId?: string | null): Promise<CustomDashboard[]> {
    let query = db
      .selectFrom('custom_dashboards')
      .selectAll()
      .where('organization_id', '=', organizationId);

    if (projectId !== undefined) {
      if (projectId === null) {
        query = query.where('project_id', 'is', null);
      } else {
        query = query.where((eb) =>
          eb.or([
            eb('project_id', '=', projectId),
            eb('project_id', 'is', null),
          ])
        );
      }
    }

    query = query.where((eb) =>
      eb.or([
        eb('is_personal', '=', false),
        eb('created_by', '=', userId),
      ])
    );

    const rows = await query.orderBy('updated_at', 'desc').execute();
    return rows.map((r) => this.mapRow(r as unknown as DashboardRow));
  }

  async getById(
    id: string,
    organizationId: string,
    userId: string
  ): Promise<CustomDashboard | null> {
    const row = await db
      .selectFrom('custom_dashboards')
      .selectAll()
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      // Personal dashboards are visible only to their creator (shared ones to any
      // org member), matching list().
      .where((eb) => eb.or([eb('is_personal', '=', false), eb('created_by', '=', userId)]))
      .executeTakeFirst();

    return row ? this.mapRow(row as unknown as DashboardRow) : null;
  }

  async create(input: CreateDashboardInput, userId: string): Promise<CustomDashboard> {
    const panels = this.validatePanels(input.panels ?? []);

    const row = await db
      .insertInto('custom_dashboards')
      .values({
        organization_id: input.organizationId,
        project_id: input.projectId ?? null,
        created_by: userId,
        name: input.name,
        description: input.description ?? null,
        is_personal: input.isPersonal ?? false,
        schema_version: CURRENT_SCHEMA_VERSION,
        panels: JSON.stringify(panels) as unknown as PanelInstance[],
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapRow(row as unknown as DashboardRow);
  }

  /**
   * Copy a dashboard the caller can see: same panels and configs with fresh
   * panel ids, same scope (project, personal flag), never the default.
   */
  async duplicate(
    id: string,
    organizationId: string,
    userId: string,
    opts: { name?: string } = {}
  ): Promise<CustomDashboard> {
    const source = await this.getById(id, organizationId, userId);
    if (!source) {
      throw new Error('Dashboard not found');
    }

    const suffix = ' (copy)';
    const name = opts.name ?? `${source.name.slice(0, 200 - suffix.length)}${suffix}`;

    return this.create(
      {
        organizationId,
        projectId: source.projectId,
        name,
        description: source.description,
        isPersonal: source.isPersonal,
        panels: source.panels.map((p) => ({ ...p, id: this.generatePanelId() })),
      },
      userId
    );
  }

  async update(
    id: string,
    organizationId: string,
    userId: string,
    input: UpdateDashboardInput
  ): Promise<CustomDashboard> {
    const updates: Record<string, unknown> = { updated_at: new Date() };

    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.isPersonal !== undefined) updates.is_personal = input.isPersonal;
    if (input.panels !== undefined) {
      updates.panels = JSON.stringify(this.validatePanels(input.panels));
      updates.schema_version = CURRENT_SCHEMA_VERSION;
    }

    const row = await db
      .updateTable('custom_dashboards')
      .set(updates)
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      // A personal dashboard can only be edited by its creator.
      .where((eb) => eb.or([eb('is_personal', '=', false), eb('created_by', '=', userId)]))
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      throw new Error('Dashboard not found');
    }

    return this.mapRow(row as unknown as DashboardRow);
  }

  /**
   * Promote an org-wide dashboard to be the default. Atomically unsets the
   * current org-wide default and sets the target. Personal or project-scoped
   * dashboards cannot be promoted - the partial unique index only covers
   * (organization_id) WHERE is_default AND project_id IS NULL, and a personal
   * dashboard as org-wide default would be visible only to its creator.
   */
  async setAsDefault(id: string, organizationId: string): Promise<CustomDashboard> {
    const target = await db
      .selectFrom('custom_dashboards')
      .selectAll()
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!target) {
      throw new Error('Dashboard not found');
    }
    if (target.is_personal) {
      throw new Error('Personal dashboards cannot be set as default');
    }
    if (target.project_id !== null) {
      throw new Error('Project-scoped dashboards cannot be set as default');
    }
    if (target.is_default) {
      return this.mapRow(target as unknown as DashboardRow);
    }

    const updated = await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('custom_dashboards')
        .set({ is_default: false, updated_at: new Date() })
        .where('organization_id', '=', organizationId)
        .where('is_default', '=', true)
        .where('project_id', 'is', null)
        .execute();

      return trx
        .updateTable('custom_dashboards')
        .set({ is_default: true, updated_at: new Date() })
        .where('id', '=', id)
        .where('organization_id', '=', organizationId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    return this.mapRow(updated as unknown as DashboardRow);
  }

  async delete(id: string, organizationId: string, userId: string): Promise<void> {
    // Refuse to delete the default dashboard - the UI would have nothing to fall back to.
    // A personal dashboard can only be deleted by its creator.
    const existing = await db
      .selectFrom('custom_dashboards')
      .select(['is_default'])
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .where((eb) => eb.or([eb('is_personal', '=', false), eb('created_by', '=', userId)]))
      .executeTakeFirst();

    if (!existing) {
      throw new Error('Dashboard not found');
    }
    if (existing.is_default) {
      throw new Error('Cannot delete the default dashboard');
    }

    await db
      .deleteFrom('custom_dashboards')
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .where((eb) => eb.or([eb('is_personal', '=', false), eb('created_by', '=', userId)]))
      .execute();
  }

  /**
   * Ensure an org-wide default dashboard exists for the given organization.
   * Idempotent - uses the partial unique index on (organization_id) WHERE
   * is_default AND project_id IS NULL to safely no-op on race conditions.
   */
  async ensureDefaultExists(
    organizationId: string,
    userId: string | null
  ): Promise<CustomDashboard> {
    const existing = await db
      .selectFrom('custom_dashboards')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('is_default', '=', true)
      .where('project_id', 'is', null)
      .executeTakeFirst();

    if (existing) {
      return this.mapRow(existing as unknown as DashboardRow);
    }

    const defaultPanels = this.buildDefaultPanels();

    try {
      const inserted = await db
        .insertInto('custom_dashboards')
        .values({
          organization_id: organizationId,
          project_id: null,
          created_by: userId,
          name: 'Default',
          description: 'Org-wide overview - clone or edit to customize.',
          is_default: true,
          is_personal: false,
          schema_version: CURRENT_SCHEMA_VERSION,
          panels: JSON.stringify(defaultPanels) as unknown as PanelInstance[],
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return this.mapRow(inserted as unknown as DashboardRow);
    } catch (err) {
      // Only treat unique-constraint violation (race with another request)
      // as recoverable. Anything else (FK violation, connection error) is a
      // real problem and must propagate so we don't mask the root cause.
      const code = (err as { code?: string } | null)?.code;
      if (code !== '23505') throw err;

      const reread = await db
        .selectFrom('custom_dashboards')
        .selectAll()
        .where('organization_id', '=', organizationId)
        .where('is_default', '=', true)
        .where('project_id', 'is', null)
        .executeTakeFirstOrThrow();
      return this.mapRow(reread as unknown as DashboardRow);
    }
  }

  /**
   * The hardcoded panel layout for the auto-created Default dashboard.
   * This replicates the previous fixed dashboard so existing users see
   * no visual change after the migration.
   */
  private buildDefaultPanels(): PanelInstance[] {
    const id = (n: number) => `default-panel-${n}`;
    return [
      {
        id: id(1),
        layout: { x: 0, y: 0, w: 3, h: 2 },
        config: {
          type: 'single_stat',
          title: 'Total logs today',
          source: 'logs',
          metric: 'total_logs',
          projectId: null,
          compareWithPrevious: true,
        },
      },
      {
        id: id(2),
        layout: { x: 3, y: 0, w: 3, h: 2 },
        config: {
          type: 'single_stat',
          title: 'Error rate',
          source: 'logs',
          metric: 'error_rate',
          projectId: null,
          compareWithPrevious: true,
        },
      },
      {
        id: id(3),
        layout: { x: 6, y: 0, w: 3, h: 2 },
        config: {
          type: 'single_stat',
          title: 'Active services',
          source: 'logs',
          metric: 'active_services',
          projectId: null,
          compareWithPrevious: true,
        },
      },
      {
        id: id(4),
        layout: { x: 9, y: 0, w: 3, h: 2 },
        config: {
          type: 'single_stat',
          title: 'Throughput',
          source: 'logs',
          metric: 'throughput',
          projectId: null,
          compareWithPrevious: true,
        },
      },
      {
        id: id(5),
        layout: { x: 0, y: 2, w: 12, h: 4 },
        config: {
          type: 'activity_overview',
          title: 'Activity overview (last 24 hours)',
          source: 'mixed',
          projectId: null,
          timeRange: '24h',
          series: ['logs', 'log_errors', 'spans', 'span_errors', 'detections', 'alerts'],
        },
      },
      {
        id: id(6),
        layout: { x: 0, y: 6, w: 6, h: 4 },
        config: {
          type: 'top_n_table',
          title: 'Top services',
          source: 'logs',
          dimension: 'service',
          limit: 5,
          projectId: null,
          interval: '7d',
        },
      },
      {
        id: id(7),
        layout: { x: 6, y: 6, w: 6, h: 4 },
        config: {
          type: 'top_n_table',
          title: 'Top error messages',
          source: 'logs',
          dimension: 'error_message',
          limit: 5,
          projectId: null,
          interval: '24h',
        },
      },
    ];
  }

  // ─── YAML import/export ─────────────────────────────────────────────────

  async exportYaml(id: string, organizationId: string, userId: string): Promise<string> {
    const dashboard = await this.getById(id, organizationId, userId);
    if (!dashboard) throw new Error('Dashboard not found');

    const exportable = {
      name: dashboard.name,
      description: dashboard.description,
      schema_version: dashboard.schemaVersion,
      panels: dashboard.panels,
    };
    return yaml.dump(exportable, { noRefs: true, sortKeys: false });
  }

  async importYaml(
    yamlText: string,
    organizationId: string,
    userId: string
  ): Promise<CustomDashboard> {
    let parsed: unknown;
    try {
      // JSON_SCHEMA disallows JS-specific tags (!!js/function, !!js/regexp,
      // !!js/undefined) which can be abused for prototype pollution / RCE.
      parsed = yaml.load(yamlText, { schema: yaml.JSON_SCHEMA });
    } catch (e) {
      throw new Error(`Invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('YAML must be a mapping object');
    }

    const obj = parsed as Record<string, unknown>;
    if (typeof obj.name !== 'string' || obj.name.length === 0) {
      throw new Error('YAML must include a non-empty "name" field');
    }

    // Clamp schema_version into the supported range. A future version (e.g. an
    // import generated by a newer build) is treated as the current version -
    // we cannot magically downgrade unknown panel shapes, but we can refuse
    // them at panel-validation time below.
    const rawSchemaVersion =
      typeof obj.schema_version === 'number' && obj.schema_version >= 1
        ? Math.min(obj.schema_version, CURRENT_SCHEMA_VERSION)
        : 1;
    const rawDoc: DashboardDocument = {
      schema_version: rawSchemaVersion,
      panels: Array.isArray(obj.panels) ? (obj.panels as PanelInstance[]) : [],
    };

    // Migrate to current version, then validate
    const migrated = migrateDashboard(rawDoc, CURRENT_SCHEMA_VERSION);
    const validated = dashboardDocumentSchema.parse(migrated);

    // Regenerate IDs to keep them unique within the importer's org
    const panelsWithFreshIds = validated.panels.map((p) => ({
      ...p,
      id: this.generatePanelId(),
    }));

    return this.create(
      {
        organizationId,
        name: obj.name,
        description: typeof obj.description === 'string' ? obj.description : null,
        panels: panelsWithFreshIds as PanelInstance[],
      },
      userId
    );
  }

  /**
   * Append one panel to a dashboard (the "Add to dashboard" contract used by
   * the metrics explorer). The config is validated with panelConfigSchema, the
   * panel gets a fresh id and is placed at x = 0 below the lowest existing
   * panel. The read-modify-write runs under a row lock so concurrent adds both
   * survive.
   */
  async addPanel(
    id: string,
    organizationId: string,
    userId: string,
    input: { config: unknown; layout?: { w?: number; h?: number } }
  ): Promise<{ dashboard: CustomDashboard; panel: PanelInstance }> {
    const config = panelConfigSchema.parse(input.config) as PanelConfig;

    if ('projectId' in config && config.projectId) {
      const project = await db
        .selectFrom('projects')
        .select('id')
        .where('id', '=', config.projectId)
        .where('organization_id', '=', organizationId)
        .executeTakeFirst();
      if (!project) {
        throw new Error('Project does not belong to the organization');
      }
    }

    const defaults = panelRegistry[config.type].defaultLayout;

    return db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('custom_dashboards')
        .selectAll()
        .where('id', '=', id)
        .where('organization_id', '=', organizationId)
        // A personal dashboard can only be edited by its creator.
        .where((eb) => eb.or([eb('is_personal', '=', false), eb('created_by', '=', userId)]))
        .forUpdate()
        .executeTakeFirst();
      if (!row) {
        throw new Error('Dashboard not found');
      }

      const current = this.mapRow(row as unknown as DashboardRow);
      const nextY = current.panels.reduce((max, p) => Math.max(max, p.layout.y + p.layout.h), 0);
      const panel = panelInstanceSchema.parse({
        id: this.generatePanelId(),
        layout: {
          x: 0,
          y: nextY,
          w: input.layout?.w ?? defaults.w,
          h: input.layout?.h ?? defaults.h,
        },
        config,
      }) as PanelInstance;

      const updated = await trx
        .updateTable('custom_dashboards')
        .set({
          panels: JSON.stringify([...current.panels, panel]) as unknown as PanelInstance[],
          schema_version: CURRENT_SCHEMA_VERSION,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .where('organization_id', '=', organizationId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return { dashboard: this.mapRow(updated as unknown as DashboardRow), panel };
    });
  }

  /**
   * Instantiate a starter template. The template YAML goes through importYaml
   * (validation, fresh panel ids); a projectId must belong to the organization.
   */
  async createFromTemplate(
    templateId: string,
    organizationId: string,
    userId: string,
    opts: { projectId?: string | null; name?: string } = {}
  ): Promise<CustomDashboard> {
    const yamlText = buildTemplateYaml(templateId, opts);
    if (yamlText === null) {
      throw new Error('Template not found');
    }

    if (opts.projectId) {
      const project = await db
        .selectFrom('projects')
        .select('id')
        .where('id', '=', opts.projectId)
        .where('organization_id', '=', organizationId)
        .executeTakeFirst();
      if (!project) {
        throw new Error('Project does not belong to the organization');
      }
    }

    return this.importYaml(yamlText, organizationId, userId);
  }

  /**
   * Stable per-panel ID. Uses crypto.randomUUID under the hood.
   */
  generatePanelId(): string {
    // Avoid pulling in nanoid; randomUUID is good enough for panel IDs.
    return `panel-${globalThis.crypto.randomUUID()}`;
  }

  /** Count custom dashboards for an organization (capability limit input). */
  async countForOrg(organizationId: string): Promise<number> {
    const row = await db
      .selectFrom('custom_dashboards')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /**
   * Look up the default layout (w/h) for a given panel type. Used by the
   * frontend "Add Panel" flow but exposed here so the registry stays the
   * single source of truth.
   */
  getDefaultLayoutFor(type: keyof typeof panelRegistry) {
    return panelRegistry[type].defaultLayout;
  }
}

export const customDashboardsService = new CustomDashboardsService();
