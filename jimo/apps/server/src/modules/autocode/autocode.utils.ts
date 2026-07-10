import { existsSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Walk up from process.cwd() to find the repo root (the directory that
 * contains apps/server/src). Used by all autocode services
 * that need to read or write project files on disk.
 */
export function resolveProjectRoot(): string {
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (existsSync(path.join(dir, 'apps', 'server', 'src'))) {
      return dir;
    }
    dir = path.resolve(dir, '..');
  }
  throw new Error(`Cannot resolve project root from cwd=${process.cwd()}`);
}
