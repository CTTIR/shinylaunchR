import path from 'node:path';
import { assertInside } from './safe-path';
import { executeStageTask, type StageTask } from './staging-worker';
export class ZipError extends Error {}
export function safeJoin(destDir: string, entryName: string): string {
  const name = entryName.replace(/\\/g, '/');
  if (
    !name ||
    name.startsWith('/') ||
    name.includes(':') ||
    name.includes('\0') ||
    name.split('/').includes('..')
  )
    throw new ZipError('Unsafe archive path');
  try {
    return assertInside(destDir, path.resolve(destDir, name));
  } catch (err) {
    throw new ZipError(String(err));
  }
}
export function extractZipBuffer(
  buf: Buffer,
  destDir: string,
  limits: Partial<StageTask> = {},
): string[] {
  try {
    return executeStageTask({ ...limits, zip: buf, dest: destDir });
  } catch (err) {
    throw new ZipError(String(err));
  }
}
export function extractZipFile(zipPath: string, destDir: string): string[] {
  try {
    return executeStageTask({ zipFile: zipPath, dest: destDir });
  } catch (err) {
    throw new ZipError(String(err));
  }
}
