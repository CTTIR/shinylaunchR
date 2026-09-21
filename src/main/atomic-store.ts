import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertInside } from './safe-path';

export function writeAtomicJson(filePath: string, value: unknown): void {
  const root = path.dirname(filePath);
  assertInside(root, filePath);
  fs.mkdirSync(root, { recursive: true });
  const temp = assertInside(root, `${filePath}.${randomUUID()}.tmp`);
  const backup = assertInside(root, `${filePath}.bak`);
  const backupTemp = assertInside(root, `${filePath}.${randomUUID()}.bak.tmp`);
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(filePath)) {
      // Only replace recovery state with parseable JSON.
      try {
        JSON.parse(fs.readFileSync(filePath, 'utf8'));
        fs.copyFileSync(filePath, backupTemp, fs.constants.COPYFILE_EXCL);
        // Windows FlushFileBuffers requires a write-capable handle.
        const backupFd = fs.openSync(backupTemp, 'r+');
        try {
          fs.fsyncSync(backupFd);
        } finally {
          fs.closeSync(backupFd);
        }
        fs.renameSync(backupTemp, backup);
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
      }
    }
    fs.renameSync(temp, filePath);
  } finally {
    for (const candidate of [temp, backupTemp])
      if (fs.existsSync(candidate)) fs.rmSync(assertInside(root, candidate));
  }
}

export function readAtomicJson<T>(
  filePath: string,
  validate: (raw: unknown) => T,
  fallback: () => T,
): T {
  for (const candidate of [filePath, `${filePath}.bak`]) {
    assertInside(path.dirname(filePath), candidate);
    try {
      return validate(JSON.parse(fs.readFileSync(candidate, 'utf8')));
    } catch (err) {
      if (candidate === filePath && fs.existsSync(candidate)) {
        const copy = assertInside(
          path.dirname(filePath),
          `${filePath}.corrupt-${Date.now()}.bak`,
        );
        fs.renameSync(candidate, copy);
      }
      if (
        (err as NodeJS.ErrnoException).code &&
        (err as NodeJS.ErrnoException).code !== 'ENOENT'
      )
        throw err;
    }
  }
  return fallback();
}
