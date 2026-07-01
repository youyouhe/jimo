import type { AutoCodeDto, AutoCodeField } from '../dto/autocode.dto';
import { toPascalCase, toCamelCase, singularize, toTsType, deriveNames } from '../autocode-field-utils';

export function generateFrontendService(dto: AutoCodeDto, relationDictTypes: Map<string, string | null> = new Map()): string {
  const n = deriveNames(dto.tableName, dto._packageSlug ?? '');
  const oneToManyFields = dto.fields.filter((f) => f.type === 'relation' && f.relationType === 'one-to-many');

  // Generate child detail interfaces for one-to-many (including grandchild)
  const childInterfaces: string[] = [];
  for (const f of oneToManyFields) {
    if (!f.detailFields || f.detailFields.length === 0) continue;
    const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
    const childPascalType = isExisting
      ? deriveNames(f.relationTable!).schemaType
      : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);

    // Grandchild interfaces first (referenced by child interface)
    for (const gf of f.detailFields) {
      if (gf.type !== 'relation' || gf.relationType !== 'one-to-many') continue;
      if (!gf.detailFields || gf.detailFields.length === 0) continue;
      const grandPascalType = toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}_${singularize(gf.name)}`);
      const grandFieldLines = gf.detailFields.map((gdf) => {
        const tsType = toTsType(gdf);
        const nullable = !gdf.required && gdf.type !== 'boolean' ? ' | null' : '';
        return `  ${gdf.name}: ${tsType}${nullable};`;
      });
      childInterfaces.push(`
export interface ${grandPascalType} {
  id: string;
${grandFieldLines.join('\n')}
  createdAt: string;
  updatedAt: string;
}
`);
    }

    const childFieldLines = f.detailFields.flatMap((df) => {
      if (df.type === 'relation' && df.relationType === 'one-to-many' && df.detailFields && df.detailFields.length > 0) {
        const grandPascalType = toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}_${singularize(df.name)}`);
        return [`  ${df.name}: ${grandPascalType}[];`];
      }
      const tsType = toTsType(df);
      const nullable = !df.required && df.type !== 'boolean' ? ' | null' : '';
      const lines = [`  ${df.name}: ${tsType}${nullable};`];
      // FK relation fields get a companion _display field from leftJoin
      if (df.type === 'relation' && (df.relationType === 'many-to-one' || df.relationType === 'many-to-many')) {
        lines.push(`  ${df.name}_display: string | null;`);
      }
      return lines;
    });
    childInterfaces.push(`
export interface ${childPascalType} {
  id: string;
${childFieldLines.join('\n')}
  createdAt: string;
  updatedAt: string;
}
`);
  }

  const fieldInterfaces = dto.fields.map((f) => {
    if (f.type === 'relation' && f.relationType === 'one-to-many') {
      const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
      const childPascalType = isExisting
        ? deriveNames(f.relationTable!).schemaType
        : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);
      const nullable = !f.required ? ' | null' : '';
      return `  ${f.name}: ${childPascalType}[]${nullable};`;
    }
    const tsType = toTsType(f);
    const nullable = !f.required && f.type !== 'boolean' ? ' | null' : '';
    if (f.type === 'relation' && (f.relationType === 'many-to-one' || f.relationType === 'many-to-many')) {
      return `  ${f.name}: ${tsType}${nullable};\n  ${f.name}_display: string | null;`;
    }
    return `  ${f.name}: ${tsType}${nullable};`;
  });

  // 'code' fields are auto-generated server-side — never user-submitted
  const createFields = dto.fields
    .filter((f) => f.creatable && f.type !== 'code' && f.type !== 'calculated')
    .map((f) => {
      if (f.type === 'relation' && f.relationType === 'one-to-many') {
        const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
        const childPascalType = isExisting
          ? deriveNames(f.relationTable!).schemaType
          : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);
        return `  ${f.name}?: ${childPascalType}[];`;
      }
      const tsType = toTsType(f);
      const opt = f.required ? '' : '?';
      return `  ${f.name}${opt}: ${tsType};`;
    });

  const updateFields = dto.fields
    .filter((f) => f.editable && f.type !== 'code' && f.type !== 'calculated')
    .map((f) => {
      if (f.type === 'relation' && f.relationType === 'one-to-many') {
        const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
        const childPascalType = isExisting
          ? deriveNames(f.relationTable!).schemaType
          : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);
        return `  ${f.name}?: ${childPascalType}[];`;
      }
      const tsType = toTsType(f);
      return `  ${f.name}?: ${tsType};`;
    });

  const isNumericF = (f: AutoCodeField) => f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal';
  const queryFields = dto.fields
    .filter((f) => f.searchable)
    .flatMap((f) => {
      if (f.type === 'relation' && (f.relationType === 'one-to-many')) {
        return [`  ${f.name}?: string[];`];
      }
      if (isNumericF(f)) {
        return [`  ${f.name}Min?: string;`, `  ${f.name}Max?: string;`];
      }
      return [`  ${f.name}?: string;`];
    });

  const relationFields = dto.fields.filter((f) => f.type === 'relation');
  const relationOptionInterfaces: string[] = [];
  const relationFetchFunctions: string[] = [];

  for (const f of relationFields) {
    if (!f.relationTable) continue;
    const targetNames = deriveNames(f.relationTable);
    const displayField = f.relationDisplayField || 'name';
    const optionInterfaceName = `${toPascalCase(singularize(f.relationTable))}Option`;
    const fetchFunctionName = `get${toPascalCase(singularize(f.relationTable))}Options`;

    relationOptionInterfaces.push(`
export interface ${optionInterfaceName} {
  id: string;
  ${displayField}: string;
}
`);

    const isMulti = f.relationType === 'many-to-many';
    const dictType = relationDictTypes.get(f.name);
    if (dictType) {
      relationFetchFunctions.push(`
/**
 * Get ${targetNames.kebabName} options for select dropdown${isMulti ? ' (multi-select)' : ''}.
 * \`${displayField}\` is a dict code from ${dictType} — resolved to human-readable label.
 */
export async function ${fetchFunctionName}(): Promise<${optionInterfaceName}[]> {
  const [res, dictItems] = await Promise.all([
    request.get('/lc/${targetNames.kebabName}', { params: { pageSize: 100 } }),
    getDictDetailsByType('${dictType}'),
  ]);
  const dictMap: Record<string, string> = {};
  dictItems.forEach((d: { label: string; value: string }) => { dictMap[d.value] = d.label; });
  const list: any[] = res.list || res.data || [];
  return list.map((item: any) => ({ ...item, ${displayField}: dictMap[item.${displayField}] ?? item.${displayField} }));
}
`);
    } else {
      relationFetchFunctions.push(`
/**
 * Get ${targetNames.kebabName} options for select dropdown${isMulti ? ' (multi-select)' : ''}.
 */
export async function ${fetchFunctionName}(): Promise<${optionInterfaceName}[]> {
  const res = await request.get('/lc/${targetNames.kebabName}', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}
`);
    }
  }

  // Generate options fetchers for FK fields inside O2M child tables (and grandchild tables)
  const oneToManyFieldsForService = dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many' && f.detailFields);
  const seenFetchers = new Set(relationFields.map(f => f.relationTable).filter(Boolean));
  for (const o2m of oneToManyFieldsForService) {
    for (const df of (o2m.detailFields || [])) {
      if (df.type === 'relation' && df.relationType === 'one-to-many' && df.detailFields) {
        // Grandchild level: scan grandchild detailFields for FK relations
        for (const gdf of df.detailFields) {
          if (gdf.type !== 'relation' || !gdf.relationTable || gdf.relationTable === dto.tableName) continue;
          if (seenFetchers.has(gdf.relationTable)) continue;
          seenFetchers.add(gdf.relationTable);
          const targetNames = deriveNames(gdf.relationTable);
          const displayField = gdf.relationDisplayField || 'name';
          const optionInterfaceName = `${toPascalCase(singularize(gdf.relationTable))}Option`;
          const fetchFunctionName = `get${toPascalCase(singularize(gdf.relationTable))}Options`;
          relationOptionInterfaces.push(`
export interface ${optionInterfaceName} {
  id: string;
  ${displayField}: string;
}
`);
          relationFetchFunctions.push(`
/**
 * Get ${targetNames.kebabName} options for select dropdown.
 */
export async function ${fetchFunctionName}(): Promise<${optionInterfaceName}[]> {
  const res = await request.get('/lc/${targetNames.kebabName}', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}
`);
        }
        continue;
      }
      if (df.type !== 'relation' || !df.relationTable || df.relationTable === dto.tableName) continue;
      if (seenFetchers.has(df.relationTable)) continue;
      seenFetchers.add(df.relationTable);
      const targetNames = deriveNames(df.relationTable);
      const displayField = df.relationDisplayField || 'name';
      const optionInterfaceName = `${toPascalCase(singularize(df.relationTable))}Option`;
      const fetchFunctionName = `get${toPascalCase(singularize(df.relationTable))}Options`;

      relationOptionInterfaces.push(`
export interface ${optionInterfaceName} {
  id: string;
  ${displayField}: string;
}
`);
      relationFetchFunctions.push(`
/**
 * Get ${targetNames.kebabName} options for select dropdown.
 */
export async function ${fetchFunctionName}(): Promise<${optionInterfaceName}[]> {
  const res = await request.get('/lc/${targetNames.kebabName}', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}
`);
    }
  }

  // Check if any grandchild uses dict — needed for getDictDetailsByType import in service
  const hasDictInGrandchildren = oneToManyFieldsForService.some(o2m =>
    (o2m.detailFields || []).some(df =>
      df.type === 'relation' && df.relationType === 'one-to-many' &&
      (df.detailFields || []).some(gdf => gdf.type === 'dict' && gdf.dictType),
    ),
  );

  const hasDictRelation = [...relationDictTypes.values()].some(v => v !== null) || hasDictInGrandchildren;
  const hasChildDictFieldsInService = oneToManyFieldsForService.some(o2m =>
    (o2m.detailFields || []).some(df => df.type === 'dict' && df.dictType),
  );
  const needsDictImportInService = hasDictRelation || hasChildDictFieldsInService;
  return `import request from '../request';${needsDictImportInService ? `\nimport { getDictDetailsByType } from '../dictionary';` : ''}
${childInterfaces.join('')}
export interface ${n.pascalSingular} {
  id: string;
${fieldInterfaces.join('\n')}
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}
${relationOptionInterfaces.join('')}
export interface ${n.pascalSingular}ListParams {
  page?: number;
  pageSize?: number;
${queryFields.map(f => `  ${f}`).join('\n')}
}

export interface ${n.pascalSingular}ListResult {
  list: ${n.pascalSingular}[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Create${n.pascalSingular}Dto {
${createFields.map(f => `  ${f}`).join('\n')}
}

export interface Update${n.pascalSingular}Dto {
${updateFields.map(f => `  ${f}`).join('\n')}
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated ${n.kebabName} list.
 */
export async function get${n.pascalName}List(params?: ${n.pascalSingular}ListParams): Promise<${n.pascalSingular}ListResult> {
  return request.get('/lc/${n.kebabName}', { params });
}

/**
 * Get a single ${n.kebabSingular} by ID.
 */
export async function get${n.pascalSingular}(id: string): Promise<${n.pascalSingular}> {
  return request.get(\`/lc/${n.kebabName}/\$\{id\}\`);
}

/**
 * Create a new ${n.kebabSingular}.
 */
export async function create${n.pascalSingular}(dto: Create${n.pascalSingular}Dto): Promise<${n.pascalSingular}> {
  return request.post('/lc/${n.kebabName}', dto);
}

/**
 * Update an existing ${n.kebabSingular}.
 */
export async function update${n.pascalSingular}(id: string, dto: Update${n.pascalSingular}Dto): Promise<${n.pascalSingular}> {
  return request.patch(\`/lc/${n.kebabName}/\$\{id\}\`, dto);
}

/**
 * Delete a ${n.kebabSingular} by ID (soft delete).
 */
export async function delete${n.pascalSingular}(id: string): Promise<void> {
  return request.delete(\`/lc/${n.kebabName}/\$\{id\}\`);
}

/**
 * Batch delete ${n.kebabName} by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDelete${n.pascalName}(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/${n.kebabName}/batch', { data: { ids } });
}
${dto.approvalFlow?.enabled ? `
/**
 * Submit this ${n.kebabSingular} for approval. The chain is resolved dynamically server-side
 * from sys_approval_flows (business_type: '${dto.tableName}') + the record.
 */
export async function submit${n.pascalSingular}Approval(id: string, record?: Record<string, any>): Promise<any> {
  return request.post('/approvals/start', { businessType: '${dto.tableName}', businessId: id, record });
}
` : ''}${dto.fields.some(f => f.type === 'relation' && f.relationType === 'many-to-one' && f.relationTable === dto.tableName) ? `
/**
 * Get all ${n.kebabName} as a nested tree (self-referential hierarchy).
 */
export async function get${n.pascalName}Tree(): Promise<(${n.pascalSingular} & { children: any[] })[]> {
  return request.get('/lc/${n.kebabName}/tree');
}
` : ''}${relationFetchFunctions.join('')}
`;
}

/** Build the template string for one field inside a create/update DTO handler. */
