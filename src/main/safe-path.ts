import fs from 'node:fs';
import path from 'node:path';

/** Refuse traversal and symlink components, including dangling symlinks. Trusted ancestors may use OS aliases. */
export function assertInside(root: string, candidate: string): string {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  const rel = path.relative(base, target);
  if (
    !rel ||
    rel === '..' ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  ) {
    throw new Error(`Path must be strictly inside ${base}`);
  }
  let cursor = base;
  for (const part of ['', ...rel.split(path.sep)]) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink())
        throw new Error(`Symlink path refused: ${cursor}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return target;
}

export function assertAppId(id: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new Error('Invalid app UUID');
  }
}
