import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { it, expect, vi, beforeAll, afterAll } from 'vitest';
import { logger } from '../src/main/logger';
import type { LogEvent } from '../src/shared/types';
import { RRuntimeManager } from '../src/main/r-runtime';
import { installPackage, installSourceDeps } from '../src/main/installer';
import { ShinySupervisor } from '../src/main/shiny-supervisor';
import { DEFAULT_SETTINGS, type AppEntry } from '../src/shared/types';
const integrationLog = (event: LogEvent) => {
  if (event.scope === 'installer') console.log(event.message);
};
beforeAll(() => {
  if (process.env.SLR_RUN_R_INTEGRATION === '1') logger.on('log', integrationLog);
});
afterAll(() => { logger.off('log', integrationLog); });

it.skipIf(process.env.SLR_RUN_R_INTEGRATION !== '1')(
  'installs CRAN praise into a fresh managed library and runs/stops real Shiny',
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-real-r-'));
    const runtime = new RRuntimeManager({ userDataDir: root });
    const supervisor = new ShinySupervisor();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 540000);
    try {
      const ready = await runtime.ready();
      expect(ready).toBeDefined();
      const lib = runtime.ensureLibrary();
      expect(fs.readdirSync(lib)).toEqual([]);
      const entry: AppEntry = {
        id: randomUUID(),
        name: 'praise integration',
        pkg: 'praise',
        fun: 'praise',
        source: { kind: 'cran' },
        installed: false,
        createdAt: new Date().toISOString(),
      };
      const installed = await installPackage(entry, {
        runtime,
        settings: { ...DEFAULT_SETTINGS, preferPak: false },
        signal: controller.signal,
      });
      expect(installed.ok, installed.message).toBe(true);
      expect(fs.existsSync(path.join(lib, 'praise', 'DESCRIPTION'))).toBe(true);
      const check = runtime.processes.startScript(
        ready!.rPath,
        'stopifnot(normalizePath(dirname(find.package("praise"))) == normalizePath(Sys.getenv("SLR_LIBRARY")));cat(praise::praise("fresh managed library"))',
        {
          owner: 'integration',
          env: runtime.childEnv({ SLR_LIBRARY: lib }),
          timeoutMs: 15000,
        },
      );
      const checked = await check.done;
      expect(checked.code).toBe(0);
      expect(checked.stdout.trim()).toBe('fresh managed library');
      // Install Shiny and its required dependencies into the same fresh managed library.
      const source = path.join(root, 'app');
      fs.mkdirSync(source);
      fs.writeFileSync(
        path.join(source, 'app.R'),
        'shiny::shinyApp(shiny::fluidPage("real-runtime-ok"), function(input,output,session){})',
      );
      const app: AppEntry = {
        ...entry,
        id: randomUUID(),
        name: 'real Shiny source',
        pkg: undefined,
        source: { kind: 'source', origin: { from: 'local', path: source } },
        installed: true,
        stagedPath: source,
      };
      const deps = await installSourceDeps(app, ['shiny'], {
        runtime,
        settings: { ...DEFAULT_SETTINGS, preferPak: false },
        signal: controller.signal,
      });
      expect(deps.ok, deps.message).toBe(true);
      const launched = await supervisor.launch(
        app,
        runtime,
        DEFAULT_SETTINGS,
        controller.signal,
      );
      expect(launched.ok, launched.message).toBe(true);
      const html = await (await fetch(launched.url!, { signal: controller.signal })).text();
      expect(html).toContain('real-runtime-ok');
      await supervisor.stop(app.id);
      expect(supervisor.isRunning(app.id)).toBe(false);
      console.log(
        JSON.stringify({
          runtime: ready,
          managedInstall: 'praise',
          launch: 'real Shiny source',
          shutdown: 'confirmed',
        }),
      );
    } finally {
      clearTimeout(timer);
      await supervisor.stopAll();
      await runtime.processes.shutdown();
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  600000,
);


it.skipIf(process.env.SLR_RUN_R_INTEGRATION !== '1')(
  'bootstraps pak and installs CRAN praise into a separate fresh managed library',
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-real-pak-'));
    const runtime = new RRuntimeManager({ userDataDir: root });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 540000);
    const site = path.join(root, 'empty-site-library');
    fs.mkdirSync(site);
    const childEnv = runtime.childEnv.bind(runtime);
    // Isolate helper discovery and pak's downloads from existing user/site libraries and caches.
    const envSpy = vi.spyOn(runtime, 'childEnv').mockImplementation((extra = {}) =>
      childEnv({
        R_LIBS: '',
        R_LIBS_SITE: site,
        PKG_CACHE_DIR: path.join(root, 'package-cache'),
        PKG_METADATA_CACHE_DIR: path.join(root, 'metadata-cache'),
        ...extra,
      }),
    );
    try {
      const ready = await runtime.ready(controller.signal);
      expect(ready).toBeDefined();
      const lib = runtime.ensureLibrary();
      expect(fs.readdirSync(lib)).toEqual([]);
      const entry: AppEntry = {
        id: randomUUID(),
        name: 'pak integration',
        pkg: 'praise',
        fun: 'praise',
        source: { kind: 'cran' },
        installed: false,
        createdAt: new Date().toISOString(),
      };
      const installed = await installPackage(entry, {
        runtime,
        settings: { ...DEFAULT_SETTINGS, preferPak: true },
        signal: controller.signal,
      });
      expect(installed.ok, installed.message).toBe(true);
      for (const pkg of ['pak', 'praise']) {
        expect(fs.existsSync(path.join(lib, pkg, 'DESCRIPTION'))).toBe(true);
      }
      const checked = await runtime.processes.startScript(
        ready!.rPath,
        'for (p in c("pak", "praise")) { stopifnot(normalizePath(dirname(find.package(p))) == normalizePath(Sys.getenv("SLR_LIBRARY"))); stopifnot(requireNamespace(p, quietly=TRUE)) }; cat("PAK_MANAGED_OK")',
        {
          owner: 'integration-pak',
          env: runtime.childEnv({ SLR_LIBRARY: lib }),
          signal: controller.signal,
          timeoutMs: 15000,
        },
      ).done;
      expect(checked.code, checked.stderr).toBe(0);
      expect(checked.stdout.trim()).toBe('PAK_MANAGED_OK');
      console.log(JSON.stringify({ runtime: ready, installer: 'pak', managedInstall: 'praise', bootstrap: 'fresh pak', verified: true }));
    } finally {
      clearTimeout(timer);
      await runtime.processes.shutdown();
      envSpy.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  600000,
);
