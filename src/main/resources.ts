/**
 * Resolve a bundled resource path that works in both development and a packaged
 * build, on every OS. In dev, resources live under the app root; when packaged,
 * electron-builder copies them under `process.resourcesPath` (see the
 * `extraResources` entry in electron-builder.yml).
 */
import path from 'node:path';
import { app } from 'electron';

export function resourcePath(...segments: string[]): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(app.getAppPath(), 'resources');
  return path.join(base, ...segments);
}
