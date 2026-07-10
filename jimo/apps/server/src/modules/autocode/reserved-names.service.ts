import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { RESERVED_TABLE_NAMES, addToReservedNames } from './reserved-names';
import { resolveProjectRoot } from './autocode.utils';

@Injectable()
export class ReservedNamesService {
  private readonly logger = new Logger(ReservedNamesService.name);

  /**
   * Return current reserved list + scan pages/ directory for names that are
   * present on disk but missing from the reserved set.
   */
  async getReservedNames(): Promise<{
    reserved: string[];
    pagesOnDisk: string[];
    missing: string[];
  }> {
    const projectRoot = resolveProjectRoot();
    const pagesDir = path.join(projectRoot, 'apps/web/src/pages');

    let entries: string[] = [];
    try {
      const dirents = await fs.readdir(pagesDir, { withFileTypes: true });
      entries = dirents
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((n) => !n.startsWith('.') && n !== 'lc');
    } catch {
      // pages dir unreadable — return what we have
    }

    const reserved = Array.from(RESERVED_TABLE_NAMES).sort();
    const missing = entries.filter((n) => !RESERVED_TABLE_NAMES.has(n)).sort();

    return { reserved, pagesOnDisk: entries.sort(), missing };
  }

  /**
   * Append the given names to the RESERVED set literal in reserved-names.ts.
   * Only names not already reserved are written.
   */
  async addReservedNames(names: string[]): Promise<{ added: string[] }> {
    const projectRoot = resolveProjectRoot();
    const reservedFile = path.join(
      projectRoot,
      'apps/server/src/modules/autocode/reserved-names.ts',
    );

    const toAdd = names.filter((n) => n && !RESERVED_TABLE_NAMES.has(n));
    if (toAdd.length === 0) return { added: [] };

    let content = await fs.readFile(reservedFile, 'utf-8');
    // Insert before the closing ]); of the RESERVED Set literal
    const insertLine = toAdd.map((n) => `  '${n}',`).join('\n');
    content = content.replace(/^(\]\);)/m, `${insertLine}\n$1`);
    await fs.writeFile(reservedFile, content, 'utf-8');
    addToReservedNames(toAdd);

    return { added: toAdd };
  }
}
