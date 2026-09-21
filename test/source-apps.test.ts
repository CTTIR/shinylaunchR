import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Registry } from '../src/main/registry';
import {
  findShinyAppDir,
  scanDependencies,
  scanDependencyModel,
  prepareSource,
  stageSource,
  removeStaged,
} from '../src/main/source-apps';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srcapp-test-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('findShinyAppDir', () => {
  it('finds app.R at the base', () => {
    fs.writeFileSync(path.join(dir, 'app.R'), 'shinyApp(ui, server)');
    expect(findShinyAppDir(dir)).toBe(dir);
  });

  it('detects ui.R + server.R (no app.R)', () => {
    fs.writeFileSync(path.join(dir, 'ui.R'), 'fluidPage()');
    fs.writeFileSync(path.join(dir, 'server.R'), 'function(input, output) {}');
    expect(findShinyAppDir(dir)).toBe(dir);
  });

  it('descends into a single wrapper directory (zip/zipball shape)', () => {
    const inner = path.join(dir, 'myapp-main');
    fs.mkdirSync(inner);
    fs.writeFileSync(path.join(inner, 'app.R'), 'x');
    expect(findShinyAppDir(dir)).toBe(inner);
  });

  it('honors an explicit appDir', () => {
    const sub = path.join(dir, 'inst', 'shiny');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'app.R'), 'x');
    expect(findShinyAppDir(dir, 'inst/shiny')).toBe(sub);
  });

  it('returns undefined when neither app.R nor ui.R+server.R exist', () => {
    fs.writeFileSync(path.join(dir, 'ui.R'), 'fluidPage()'); // server.R missing
    expect(findShinyAppDir(dir)).toBeUndefined();
  });
});

describe('scanDependencies', () => {
  it('always includes shiny and excludes base packages', () => {
    fs.writeFileSync(path.join(dir, 'app.R'), 'library(stats)\n# nothing else');
    const deps = scanDependencies(dir);
    expect(deps).toContain('shiny');
    expect(deps).not.toContain('stats');
  });

  it('picks up library(), require(), requireNamespace() and pkg::', () => {
    fs.writeFileSync(
      path.join(dir, 'app.R'),
      [
        'library(shiny)',
        'require(dplyr)',
        'requireNamespace("jsonlite")',
        'x <- ggplot2::ggplot()',
      ].join('\n'),
    );
    const deps = scanDependencyModel(dir);
    expect(deps.required).toEqual(['shiny']);
    expect(deps.advisory).toEqual(
      expect.arrayContaining(['dplyr', 'jsonlite', 'ggplot2']),
    );
  });

  it('parses DESCRIPTION Imports/Depends with version constraints', () => {
    fs.writeFileSync(path.join(dir, 'app.R'), 'shinyApp(ui, server)');
    fs.writeFileSync(
      path.join(dir, 'DESCRIPTION'),
      [
        'Package: demo',
        'Imports:',
        '    DT,',
        '    plotly (>= 4.0)',
        'Depends: R (>= 4.2)',
      ].join('\n'),
    );
    const deps = scanDependencies(dir);
    expect(deps).toEqual(expect.arrayContaining(['DT', 'plotly']));
    expect(deps).not.toContain('R');
  });

  it('parses renv.lock packages', () => {
    fs.writeFileSync(path.join(dir, 'app.R'), 'shinyApp(ui, server)');
    fs.writeFileSync(
      path.join(dir, 'renv.lock'),
      JSON.stringify({
        Packages: {
          leaflet: { Package: 'leaflet' },
          base: { Package: 'base' },
        },
      }),
    );
    const deps = scanDependencies(dir);
    expect(deps).toContain('leaflet');
    expect(deps).not.toContain('base');
  });
});

const id = '12345678-1234-1234-1234-123456789abc';
function entry(src: string) {
  return {
    id,
    name: 'Demo',
    source: {
      kind: 'source' as const,
      origin: { from: 'local' as const, path: src },
    },
    installed: true,
    createdAt: '',
  };
}
it('keeps working staging through preparation and dependency failure; swaps only on commit', async () => {
  const src = path.join(dir, 'source');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'app.R'), 'old');
  const userDataDir = path.join(dir, 'user');
  const first = await stageSource(entry(src), { userDataDir });
  expect(first.ok, first.message).toBe(true);
  fs.writeFileSync(path.join(src, 'app.R'), 'new');
  const prepared = await prepareSource(entry(src), { userDataDir });
  expect(prepared.ok, prepared.message).toBe(true);
  expect(fs.readFileSync(path.join(first.appDir!, 'app.R'), 'utf8')).toBe(
    'old',
  );
  prepared.rollback();
  expect(fs.readFileSync(path.join(first.appDir!, 'app.R'), 'utf8')).toBe(
    'old',
  );
  const next = await prepareSource(entry(src), { userDataDir });
  expect(fs.readFileSync(path.join(next.commit(), 'app.R'), 'utf8')).toBe(
    'new',
  );
});
it('rejects unsafe IDs and symlink source files while preserving outside data', async () => {
  const src = path.join(dir, 'source');
  fs.mkdirSync(src);
  const outside = path.join(dir, 'outside');
  fs.writeFileSync(outside, 'keep');
  fs.symlinkSync(outside, path.join(src, 'app.R'));
  const result = await stageSource(entry(src), {
    userDataDir: path.join(dir, 'user'),
  });
  expect(result.ok).toBe(false);
  expect(() => removeStaged(dir, '../outside')).toThrow();
  expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
});
it('cancels before staging and excludes managed/cache directories from local copies', async () => {
  const src = path.join(dir, 'source');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'app.R'), 'shiny');
  fs.mkdirSync(path.join(src, 'renv'));
  fs.writeFileSync(path.join(src, 'renv', 'cache'), 'skip');
  const userDataDir = path.join(dir, 'user');
  const aborted = new AbortController();
  aborted.abort();
  expect(
    (await prepareSource(entry(src), { userDataDir, signal: aborted.signal }))
      .ok,
  ).toBe(false);
  const prepared = await prepareSource(entry(src), { userDataDir });
  expect(prepared.ok, prepared.message).toBe(true);
  expect(fs.existsSync(path.join(prepared.appDir!, 'renv'))).toBe(false);
  prepared.rollback();
});
it('does not promote optional, commented, or C++ references into required dependencies', () => {
  fs.writeFileSync(
    path.join(dir, 'app.R'),
    '# library(fake)\nrequireNamespace("optional", quietly=TRUE)\n# std::vector',
  );
  fs.writeFileSync(
    path.join(dir, 'DESCRIPTION'),
    'Imports: DT\nSuggests: optional',
  );
  expect(scanDependencies(dir)).toEqual(['DT', 'shiny']);
});

it('waits for active worker cancellation before caller cleanup', async () => {
  const { runStageTask } = await import('../src/main/staging-worker');
  const src = path.join(dir, 'source');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'app.R'), 'hello');
  const dest = path.join(dir, 'candidate');
  const controller = new AbortController();
  const pending = runStageTask({ source: src, dest }, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow(/cancelled/);
  fs.rmSync(dest, { recursive: true, force: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(fs.existsSync(dest)).toBe(false);
});
it('bounds local copies by actual size and entry count', async () => {
  const { runStageTask } = await import('../src/main/staging-worker');
  const src = path.join(dir, 'source');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'app.R'), 'hello');
  await expect(
    runStageTask({ source: src, dest: path.join(dir, 'bytes'), maxBytes: 4 }),
  ).rejects.toThrow(/budget/);
  fs.writeFileSync(path.join(src, 'other.R'), 'x');
  await expect(
    runStageTask({
      source: src,
      dest: path.join(dir, 'entries'),
      maxEntries: 1,
    }),
  ).rejects.toThrow(/budget/);
});

it('restores the previous revision after a committed swap when publication fails', async () => {
  const src = path.join(dir, 'source');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'app.R'), 'old');
  const userDataDir = path.join(dir, 'user');
  const first = await stageSource(entry(src), { userDataDir });
  fs.writeFileSync(path.join(first.appDir!, 'app-data.txt'), 'preserved data');
  fs.writeFileSync(path.join(src, 'app.R'), 'new');
  const prepared = await prepareSource(entry(src), { userDataDir });
  const finalDir = prepared.commit();
  expect(fs.readFileSync(path.join(finalDir, 'app.R'), 'utf8')).toBe('new');
  expect(
    fs
      .readdirSync(path.join(userDataDir, 'apps'))
      .some((name) => name.includes('.previous-')),
  ).toBe(true);
  // Registry persistence fails here: the caller rolls back the committed swap.
  prepared.rollback();
  expect(fs.readFileSync(path.join(finalDir, 'app.R'), 'utf8')).toBe('old');
  expect(fs.readFileSync(path.join(finalDir, 'app-data.txt'), 'utf8')).toBe(
    'preserved data',
  );
  expect(fs.readdirSync(path.join(userDataDir, 'apps'))).toEqual([id]);
});
it('finalization retires the previous revision only after publication', async () => {
  const src = path.join(dir, 'source');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'app.R'), 'old');
  const userDataDir = path.join(dir, 'user');
  await stageSource(entry(src), { userDataDir });
  fs.writeFileSync(path.join(src, 'app.R'), 'new');
  const prepared = await prepareSource(entry(src), { userDataDir });
  expect(() => prepared.finalize()).toThrow(/Commit/);
  const finalDir = prepared.commit();
  prepared.finalize();
  prepared.rollback();
  expect(fs.readFileSync(path.join(finalDir, 'app.R'), 'utf8')).toBe('new');
  expect(fs.readdirSync(path.join(userDataDir, 'apps'))).toEqual([id]);
});
it('rolls back a committed first install without leaving unregistered source files', async () => {
  const src = path.join(dir, 'source');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'app.R'), 'new');
  const userDataDir = path.join(dir, 'user');
  const prepared = await prepareSource(entry(src), { userDataDir });
  const finalDir = prepared.commit();
  prepared.rollback();
  expect(fs.existsSync(finalDir)).toBe(false);
  expect(fs.readdirSync(path.join(userDataDir, 'apps'))).toEqual([]);
});

it('restores source and durable registry state together when registry rename fails', async () => {
  const src = path.join(dir, 'source');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'app.R'), 'old');
  const userDataDir = path.join(dir, 'user');
  const file = path.join(userDataDir, 'registry.json');
  const registry = new Registry(file);
  const app = registry.add({
    name: 'Demo',
    source: { kind: 'source', origin: { from: 'local', path: src } },
  });
  const first = await stageSource(app, { userDataDir });
  registry.patch(app.id, { installed: true, stagedPath: first.appDir });
  fs.writeFileSync(path.join(src, 'app.R'), 'new');
  const prepared = await prepareSource(app, { userDataDir });
  const finalDir = prepared.commit();
  const rename = fs.renameSync;
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (to === file) throw new Error('registry disk failure');
    return rename(from, to);
  });
  expect(() =>
    registry.patch(app.id, {
      stagedPath: finalDir,
      installed: true,
      libraryPath: '/new-library',
    }),
  ).toThrow('registry disk failure');
  prepared.rollback();
  expect(fs.readFileSync(path.join(finalDir, 'app.R'), 'utf8')).toBe('old');
  expect(registry.get(app.id)?.installed).toBe(true);
  expect(registry.get(app.id)?.libraryPath).toBeUndefined();
  expect(
    JSON.parse(fs.readFileSync(file, 'utf8')).apps[0].libraryPath,
  ).toBeUndefined();
});
