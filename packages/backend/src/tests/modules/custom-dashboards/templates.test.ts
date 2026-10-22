import { describe, it, expect, beforeEach } from 'vitest';
import yaml from 'js-yaml';
import { CustomDashboardsService } from '../../../modules/custom-dashboards/service.js';
import {
  listDashboardTemplates,
  buildTemplateYaml,
  type DashboardTemplateId,
} from '../../../modules/custom-dashboards/templates.js';
import { dashboardDocumentSchema } from '../../../modules/custom-dashboards/panel-registry.js';
import { createTestContext } from '../../helpers/index.js';

const IDS: DashboardTemplateId[] = [
  'service-health',
  'errors-overview',
  'web-vitals',
  'security-overview',
];

const PROJECT = '11111111-1111-4111-8111-111111111111';

function parseTemplate(id: string, opts?: { projectId?: string | null; name?: string }) {
  const text = buildTemplateYaml(id, opts);
  expect(text).not.toBeNull();
  return yaml.load(text as string, { schema: yaml.JSON_SCHEMA }) as {
    name: string;
    description: string;
    schema_version: number;
    panels: Array<{ id: string; layout: { x: number; y: number; w: number; h: number }; config: Record<string, unknown> }>;
  };
}

describe('dashboard templates', () => {
  it('every template validates against dashboardDocumentSchema', () => {
    for (const id of IDS) {
      const doc = parseTemplate(id);
      const parsed = dashboardDocumentSchema.safeParse({
        schema_version: doc.schema_version,
        panels: doc.panels,
      });
      expect(parsed.success, `${id}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
  });

  it('every layout fits the 12 column grid', () => {
    for (const id of IDS) {
      for (const p of parseTemplate(id).panels) {
        expect(p.layout.x + p.layout.w).toBeLessThanOrEqual(12);
      }
    }
  });

  it('every panel title is sentence case (no word after the first starts uppercase unless acronym)', () => {
    for (const id of IDS) {
      const doc = parseTemplate(id);
      const titles = [doc.name, ...doc.panels.map((p) => p.config.title as string)];
      for (const title of titles) {
        const words = title.split(/\s+/);
        for (const word of words.slice(1)) {
          const isAcronym = /^[A-Z0-9]{2,}$/.test(word);
          expect(/^[A-Z]/.test(word) && !isAcronym, `"${title}" word "${word}"`).toBe(false);
        }
        expect(title).not.toMatch(/[\u2013\u2014]/);
      }
    }
  });

  it('buildTemplateYaml applies projectId to every panel config', () => {
    for (const id of IDS) {
      const doc = parseTemplate(id, { projectId: PROJECT });
      expect(doc.panels.length).toBeGreaterThan(0);
      for (const p of doc.panels) {
        expect(p.config.projectId).toBe(PROJECT);
      }
    }
    for (const p of parseTemplate('service-health').panels) {
      expect(p.config.projectId).toBeNull();
    }
  });

  it('buildTemplateYaml honours the name override', () => {
    expect(parseTemplate('web-vitals', { name: 'My vitals' }).name).toBe('My vitals');
    expect(parseTemplate('web-vitals').name).toBe('Web vitals');
  });

  it('buildTemplateYaml returns null for unknown id', () => {
    expect(buildTemplateYaml('nope')).toBeNull();
  });

  it('listDashboardTemplates exposes 4 templates with panelTypes', () => {
    const list = listDashboardTemplates();
    expect(list.map((t) => t.id)).toEqual(IDS);
    for (const t of list) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.panelCount).toBe(parseTemplate(t.id).panels.length);
      expect(t.panelTypes.length).toBeGreaterThan(0);
      expect(new Set(t.panelTypes).size).toBe(t.panelTypes.length);
    }
    const health = list.find((t) => t.id === 'service-health')!;
    expect(health.panelTypes).toEqual(
      expect.arrayContaining(['single_stat', 'time_series', 'trace_latency', 'monitor_status'])
    );
  });

  it('web vitals template reads the flat performance.* metadata keys', () => {
    const fields = parseTemplate('web-vitals')
      .panels.filter((p) => p.config.type === 'top_n_table')
      .map((p) => p.config.metadataField);
    expect(fields).toEqual(['performance.metric', 'performance.rating']);
  });
});

describe('CustomDashboardsService.createFromTemplate', () => {
  let service: CustomDashboardsService;
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeEach(async () => {
    service = new CustomDashboardsService();
    ctx = await createTestContext();
  });

  it('creates a dashboard with fresh panel ids and the template name', async () => {
    const d = await service.createFromTemplate('errors-overview', ctx.organization.id, ctx.user.id);
    expect(d.name).toBe('Errors overview');
    expect(d.isDefault).toBe(false);
    expect(d.panels).toHaveLength(5);
    const ids = d.panels.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^panel-/);
      expect(id).not.toMatch(/^template-/);
    }

    const second = await service.createFromTemplate('errors-overview', ctx.organization.id, ctx.user.id);
    expect(second.panels.map((p) => p.id).some((id) => ids.includes(id))).toBe(false);
  });

  it('honours the name override and a project of the organization', async () => {
    const d = await service.createFromTemplate('security-overview', ctx.organization.id, ctx.user.id, {
      name: 'SOC board',
      projectId: ctx.project.id,
    });
    expect(d.name).toBe('SOC board');
    for (const p of d.panels) {
      expect((p.config as { projectId: string | null }).projectId).toBe(ctx.project.id);
    }
  });

  it('rejects a project of another organization and creates no row', async () => {
    const other = await createTestContext();
    await expect(
      service.createFromTemplate('service-health', ctx.organization.id, ctx.user.id, {
        projectId: other.project.id,
      })
    ).rejects.toThrow('Project does not belong to the organization');
    expect(await service.countForOrg(ctx.organization.id)).toBe(0);
  });

  it('throws Template not found', async () => {
    await expect(
      service.createFromTemplate('nope', ctx.organization.id, ctx.user.id)
    ).rejects.toThrow('Template not found');
  });

  it('every template can be instantiated', async () => {
    for (const id of IDS) {
      const d = await service.createFromTemplate(id, ctx.organization.id, ctx.user.id);
      expect(d.panels.length).toBeGreaterThan(0);
    }
  });
});
