import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findShinyAppDir, scanDependencies } from '../src/main/source-apps';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srcapp-test-'));
});
afterEach(() => {
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
    const deps = scanDependencies(dir);
    expect(deps).toEqual(expect.arrayContaining(['shiny', 'dplyr', 'jsonlite', 'ggplot2']));
  });

  it('parses DESCRIPTION Imports/Depends with version constraints', () => {
    fs.writeFileSync(
      path.join(dir, 'app.R'),
      'shinyApp(ui, server)',
    );
    fs.writeFileSync(
      path.join(dir, 'DESCRIPTION'),
      ['Package: demo', 'Imports:', '    DT,', '    plotly (>= 4.0)', 'Depends: R (>= 4.2)'].join('\n'),
    );
    const deps = scanDependencies(dir);
    expect(deps).toEqual(expect.arrayContaining(['DT', 'plotly']));
    expect(deps).not.toContain('R');
  });

  it('parses renv.lock packages', () => {
    fs.writeFileSync(path.join(dir, 'app.R'), 'shinyApp(ui, server)');
    fs.writeFileSync(
      path.join(dir, 'renv.lock'),
      JSON.stringify({ Packages: { leaflet: { Package: 'leaflet' }, base: { Package: 'base' } } }),
    );
    const deps = scanDependencies(dir);
    expect(deps).toContain('leaflet');
    expect(deps).not.toContain('base');
  });
});
