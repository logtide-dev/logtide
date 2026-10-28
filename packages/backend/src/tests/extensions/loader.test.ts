import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadExtensionModules } from '../../extensions/loader.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'extensions');
const fx = (n: string) => path.join(dir, n);

describe('loadExtensionModules', () => {
  it('returns [] for empty or missing spec', async () => {
    expect(await loadExtensionModules(undefined)).toEqual([]);
    expect(await loadExtensionModules('')).toEqual([]);
    expect(await loadExtensionModules(' , ')).toEqual([]);
  });

  it('loads a valid module', async () => {
    const mods = await loadExtensionModules(fx('valid.mjs'));
    expect(mods).toHaveLength(1);
    expect(mods[0].name).toBe('fixture');
  });

  it.each(['no-default.mjs', 'bad-version.mjs', 'bad-name.mjs', 'throws.mjs'])(
    'rejects %s with prefix and path',
    async (file) => {
      const err = await loadExtensionModules(fx(file)).catch((e) => e as Error);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('[Extensions]');
      expect((err as Error).message).toContain(path.resolve(fx(file)));
    }
  );

  it('rejects a missing file', async () => {
    await expect(loadExtensionModules(fx('nope.mjs'))).rejects.toThrow('[Extensions]');
  });

  it('rejects duplicate names', async () => {
    await expect(loadExtensionModules(`${fx('valid.mjs')},${fx('valid.mjs')}`)).rejects.toThrow(
      "duplicate extension name 'fixture'"
    );
  });

  describe('reserved names', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-reserved-'));
    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it.each(['public', 'information_schema', 'graphile_worker', 'pg_catalog', 'pg_anything'])(
      "rejects '%s'",
      async (name) => {
        const file = path.join(tmp, `${name}.mjs`);
        fs.writeFileSync(file, `export default { name: '${name}', apiVersion: 1, register() {} };`);
        await expect(loadExtensionModules(file)).rejects.toThrow(
          `[Extensions] Module ${file} uses reserved extension name '${name}'`
        );
      }
    );

    it('accepts names that only contain a reserved word', async () => {
      const file = path.join(tmp, 'mypg_public.mjs');
      fs.writeFileSync(file, "export default { name: 'mypg_public', apiVersion: 1, register() {} };");
      const mods = await loadExtensionModules(file);
      expect(mods[0].name).toBe('mypg_public');
    });
  });
});
