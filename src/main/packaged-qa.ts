/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, safeStorage } from 'electron';
import { CredentialStore } from './credentials';
import { createLegacyBackend } from './legacy-credentials';

/** Runs only with the explicit smoke switch and an isolated profile. */
export async function packagedUiChecks(win: BrowserWindow, root: string): Promise<Record<string, unknown>> {
  const evaluate = (source: string) => win.webContents.executeJavaScript(source);
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 80));
  const until = async (expression: string) => {
    for (let i = 0; i < 40; i++) {
      if (await evaluate(expression)) return;
      await settle();
    }
    const state = await evaluate('({focus:document.hasFocus(),active:document.activeElement?.outerHTML,dialogs:document.querySelectorAll("[role=dialog]").length})');
    throw new Error(`Packaged UI condition timed out: ${expression}; state=${JSON.stringify(state)}`);
  };
  const key = async (keyCode: string, modifiers: ('shift')[] = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await settle();
  };
  const axePath = process.env.SLR_SMOKE_AXE_PATH;
  if (!axePath || !path.isAbsolute(axePath)) throw new Error('An absolute SLR_SMOKE_AXE_PATH is required.');
  await evaluate(fs.readFileSync(axePath, 'utf8'));
  const accessibility: unknown[] = [];
  const axe = async (view: string) => {
    const result = await evaluate(`axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>({violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),passes:r.passes.length,incomplete:r.incomplete.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))}))`);
    accessibility.push({ view, ...result });
    if (result.violations.length) throw new Error(`Accessibility violations in ${view}: ${JSON.stringify(result.violations)}`);
  };
  win.show();
  win.focus();
  win.webContents.focus();
  await until('!!Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Add app"))');
  await until('document.hasFocus()');
  const keyboard: string[] = [];
  for (const theme of ['dark', 'light']) {
  await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  await axe(`${theme}:dashboard`);
  for (const label of ['Add app', 'Settings', 'Help']) {
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(label)})).focus()`);
    await key('Enter');
    await until('!!document.querySelector("[role=dialog]")?.contains(document.activeElement)');
    const focusables = `Array.from(document.querySelector('[role=dialog]').querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(e=>!e.hidden&&!e.closest('[hidden],[inert]'))`;
    await evaluate(`(${focusables}).at(-1).focus()`);
    await key('Tab');
    await until(`document.activeElement===(${focusables})[0]`);
    await key('Tab', ['shift']);
    await until(`document.activeElement===(${focusables}).at(-1)`);
    await axe(`${theme}:${label}`);
    await key('Escape');
    await until(`!document.querySelector('[role=dialog]') && document.activeElement.textContent.includes(${JSON.stringify(label)})`);
    keyboard.push(`${theme}:${label}: native Enter, initial focus, Tab and Shift+Tab wrapping, Escape and focus restoration`);
  }
  }
  const screenshot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(root, 'dashboard.png'), screenshot.toPNG());
  return { keyboard, accessibility, screenshot: 'dashboard.png', screenReader: 'not assessed by automated smoke' };
}

export async function packagedCredentialCheck(root: string): Promise<Record<string, unknown>> {
  if (process.env.SLR_SMOKE_CREDENTIALS !== '1') return { status: 'skipped', reason: 'Requires explicit opt-in with an isolated OS credential service.' };
  if (process.platform !== 'linux' || !process.env.XDG_DATA_HOME ||
      !fs.realpathSync(process.env.XDG_DATA_HOME).startsWith(fs.realpathSync(root) + path.sep) ||
      !process.env.DBUS_SESSION_BUS_ADDRESS) throw new Error('Credential smoke requires Linux with a private D-Bus session and XDG_DATA_HOME inside the smoke root.');
  const directory = path.join(root, 'synthetic-credentials');
  fs.mkdirSync(directory);
  const legacy = process.env.SLR_SMOKE_LEGACY === '1' ? createLegacyBackend() : undefined;
  const token = 'smoke-only-test-token-1234';
  // Check the fixture before allowing migration to remove an OS credential.
  if (legacy && await legacy.getPassword('shinylaunchR', 'github-pat') !== token)
    throw new Error('Isolated legacy credential fixture is missing or unexpected.');
  const store = new CredentialStore(directory, safeStorage, legacy);
  if (legacy && await store.getToken() !== token) throw new Error('Synthetic legacy migration failed.');
  const status = legacy ? await store.status() : await store.set(token);
  const legacyRemoved = legacy ? await legacy.getPassword('shinylaunchR', 'github-pat') === null : null;
  if (legacy && !legacyRemoved) throw new Error('Synthetic legacy credential was not removed.');
  const restored = new CredentialStore(directory, safeStorage);
  if (status.backend !== 'safeStorage') {
    if (fs.existsSync(path.join(directory, 'credentials.json'))) throw new Error('Unavailable encryption persisted a token.');
    return { status: 'unavailable', backend: status.backend, sessionOnly: (await store.getToken()) === token, restartEmpty: (await restored.getToken()) === null };
  }
  const roundTrip = (await restored.getToken()) === token;
  const plaintextAbsent = !fs.readFileSync(path.join(directory, 'credentials.json'), 'utf8').includes(token);
  await restored.remove();
  const removed = (await new CredentialStore(directory, safeStorage).getToken()) === null;
  if (!roundTrip || !plaintextAbsent || !removed) throw new Error('Synthetic credential encryption/restoration/removal failed.');
  return { status: 'verified', backend: status.backend, roundTrip, plaintextAbsent, removed, legacyRemoved, scope: 'Synthetic token with fresh store instances; full OS/process relaunch not assessed.' };
}
