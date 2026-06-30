import type { AutoCodeDto, AutoCodeField } from './dto/autocode.dto';
import {
  toPascalCase,
  toCamelCase,
  singularize,
  toTsType,
  getProFormComponent,
  getValueType,
  deriveNames,
} from './autocode-field-utils';

/**
 * Generate frontend API service file.
 */
export function generateFrontendService(dto: AutoCodeDto, relationDictTypes: Map<string, string | null> = new Map()): string {
  const n = deriveNames(dto.tableName);
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
function buildDtoFieldTemplate(f: AutoCodeField): string {
  if (f.type === 'relation' && f.relationType === 'one-to-many') {
    const tsFields = (f.detailFields || []).filter((df: any) => df.type === 'timestamp' && df.name !== 'id');
    const tsOverrides = tsFields.map((df: any) => `            ${df.name}: d.${df.name} && typeof d.${df.name} === 'object' ? d.${df.name}.toISOString() : d.${df.name},`).join('\n');
    const grandchildNormalize = (f.detailFields || [])
      .filter(df => df.type === 'relation' && df.relationType === 'one-to-many' && df.detailFields && df.detailFields.length > 0)
      .map(gf => `            ${gf.name}: (d.${gf.name} || []).map((g: any) => ({ ...g, id: g.id?.length < 36 ? undefined : g.id })),`)
      .join('\n');
    return `          ${f.name}: (values.${f.name} || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
${grandchildNormalize ? grandchildNormalize + '\n' : ''}${tsOverrides ? tsOverrides + '\n' : ''}          })),`;
  }
  if (f.type === 'boolean') return `          ${f.name}: values.${f.name} ?? false,`;
  if (f.type === 'integer' || f.type === 'bigint') return `          ${f.name}: values.${f.name} ?? 0,`;
  if (f.type === 'decimal') return `          ${f.name}: String(values.${f.name} ?? '0'),`;
  if (f.type === 'relation') return `          ${f.name}: values.${f.name} || undefined,`;
  if (f.type === 'image' || f.type === 'file') {
    return `          ${f.name}: (() => {
            const v = values.${f.name};
            if (typeof v === 'string') return v;
            if (Array.isArray(v) && v.length > 0) {
              const item = v[0];
              return item?.response?.url || item?.url || '';
            }
            return '';
          })(),`;
  }
  if (f.type === 'timestamp') {
    return `          ${f.name}: values.${f.name} && typeof values.${f.name} === 'object' ? values.${f.name}.toISOString() : values.${f.name} || undefined,`;
  }
  return `          ${f.name}: values.${f.name} || '',`;
}

/** Build ProColumn definition strings for the ProTable. */
function buildColumns(
  listableFields: AutoCodeField[],
  dto: AutoCodeDto,
  relationDictTypes: Map<string, string | null>,
): string[] {
  return listableFields.map((f) => {
    const valueType = getValueType(f);
    if (f.type === 'boolean') {
      return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: 'switch',
      width: 100,
      search: false,
    },`;
    }
    if (f.type === 'image') {
      return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: '${valueType}',
      width: 120,
      search: false,
      render: (_, record) => record.${f.name}
        ? <Image src={record.${f.name}} width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} preview={{ mask: '预览' }} fallback={'data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60'><rect width='60' height='60' fill='#f0f0f0'/><text x='30' y='35' font-size='11' fill='#bbb' text-anchor='middle'>IMG</text></svg>")} />
        : '-',
    },`;
    }
    if (f.type === 'file') {
      return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: '${valueType}',
      width: 180,
      search: false,
      render: (_, record) => record.${f.name} ? <a href={record.${f.name}} target="_blank" rel="noreferrer">{'${f.description || f.name}'}</a> : '-',
    },`;
    }
    if (f.type === 'point') {
      return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: 'text',
      width: 160,
      search: false,
      render: (_, record) => <GeoField mode="preview" value={record.${f.name}} height={120} />,
    },`;
    }
    if (f.type === 'relation' && (f.relationType === 'many-to-one' || f.relationType === 'many-to-many')) {
      const m2oDictType = relationDictTypes.get(f.name);
      const renderExpr = m2oDictType
        ? `{ const code = record.${f.name}_display || record.${f.name}; return ${toCamelCase(f.name)}TypeMap[code ?? ''] ?? code; }`
        : `record.${f.name}_display || '-'`;
      return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: '${valueType}',
      width: 180,
      search: false,
      render: (_, record) => ${renderExpr},
    },`;
    }
    if (f.type === 'relation' && f.relationType === 'one-to-many') {
      const displayField = f.relationDisplayField;
      const renderLogic = displayField
        ? `const items = record.${f.name} || [];
        if (items.length === 0) return '-';
        const names = items.slice(0, 3).map(i => i.${displayField}).filter(Boolean).join(', ');
        return items.length > 3 ? names + '... 等' + items.length + '条' : names;`
        : `const items = record.${f.name} || [];
        return items.length > 0 ? items.length + ' 条' : '-';`;
      return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: 'text',
      width: 150,
      search: false,
      render: (_, record) => {
        ${renderLogic}
      },
    },`;
    }
    if (f.type === 'dict') {
      return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: 'select',
      width: 120,
      search: false,
      valueEnum: ${toCamelCase(f.name)}Options,
    },`;
    }
    const sorterExpr = (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal')
      ? `sorter: (a, b) => (Number(a.${f.name} ?? 0) - Number(b.${f.name} ?? 0)),`
      : (f.type === 'timestamp')
      ? `sorter: (a, b) => new Date(a.${f.name} as string).getTime() - new Date(b.${f.name} as string).getTime(),`
      : (f.type === 'varchar' || f.type === 'text')
      ? `sorter: (a, b) => String(a.${f.name} ?? '').localeCompare(String(b.${f.name} ?? '')),`
      : '';
    return `    {
      title: '${f.description || f.name}',
      dataIndex: '${f.name}',
      valueType: '${valueType}',
      width: 180,
      ${sorterExpr}
    },`;
  });
}

/** Build form field JSX strings for create/edit ModalForm, including grandchild sub-components. */
function buildFormFields(
  creatableFields: AutoCodeField[],
  dto: AutoCodeDto,
): { formFields: string[]; grandchildSubComponents: string[] } {
  const grandchildSubComponents: string[] = [];
  const formFields = creatableFields.map((f) => {
    const component = getProFormComponent(f);
    const requiredRule = f.required ? `rules={[{ required: true, message: '请${f.type === 'relation' ? '选择' : '输入'}${f.description || f.name}' }]}` : '';
    const disabledWhenEditing = f.unique ? `disabled={!!editingRecord}` : '';

    if (f.type === 'code') {
      return `          {editingRecord && (
            <ProFormText
              name="${f.name}"
              label="${f.description || f.name}"
              disabled
            />
          )}`;
    }

    if (f.type === 'calculated') {
      // Virtual field — computed on read, never rendered in create/edit forms.
      return '';
    }

    if (f.type === 'relation') {
      if (f.relationType === 'one-to-many' && f.detailFields && f.detailFields.length > 0) {
        const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
        const childPascalType = isExisting
          ? deriveNames(f.relationTable!).schemaType
          : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);
        const detailCols = f.detailFields.filter(df => df.name !== 'id' && !(df.type === 'relation' && df.relationTable === dto.tableName) && !(df.type === 'relation' && df.relationType === 'one-to-many'));
        const grandchildO2MFields = f.detailFields.filter(df => df.type === 'relation' && df.relationType === 'one-to-many' && df.detailFields && df.detailFields.length > 0);
        const editableColumns = detailCols.map((df) => {
          if (df.type === 'relation' && df.relationTable) {
            const relDisplay = df.relationDisplayField || 'name';
            const relFetchFn = `get${toPascalCase(singularize(df.relationTable))}Options`;
            return `        {
          title: '${df.description || df.name}',
          dataIndex: '${df.name}',
          valueType: 'select',
          render: (_: any, r: any) => r.${df.name}_display || r.${df.name},
          formItemProps: { rules: [{ required: ${df.required} }] },
          request: async () => {
            const res = await ${relFetchFn}();
            return res.map((item: any) => ({ label: item.${relDisplay}, value: item.id }));
          },
          fieldProps: { showSearch: true },
        },`;
          }
          if (df.type === 'dict' && df.dictType) {
            return `        {
          title: '${df.description || df.name}',
          dataIndex: '${df.name}',
          valueType: 'select',
          formItemProps: { rules: [{ required: ${df.required} }] },
          request: async () => {
            const list = await getDictDetailsByType('${df.dictType}');
            return list.map((item: any) => ({ label: item.label, value: item.value }));
          },
        },`;
          }
          return `        {
          title: '${df.description || df.name}',
          dataIndex: '${df.name}',
          valueType: '${df.type === 'integer' || df.type === 'bigint' || df.type === 'decimal' ? 'digit' : df.type === 'timestamp' ? 'dateTime' : 'text'}',
          formItemProps: { rules: [{ required: ${df.required} }] },
        },`;
        });
        const emptyRow = detailCols.map(df => {
          if (df.type === 'relation') return `${df.name}: ''`;
          return `${df.name}: ${df.type === 'integer' || df.type === 'bigint' || df.type === 'decimal' ? '0' : df.type === 'timestamp' ? 'null' : "''"}`;
        }).concat(grandchildO2MFields.map(gf => `${gf.name}: []`)).join(', ');

        const grandchildColumnDefs = grandchildO2MFields.map((gf) => {
          const grandPascalType = toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}_${singularize(gf.name)}`);
          const grandCols = (gf.detailFields || []).filter(gdf => gdf.name !== 'id' && !(gdf.type === 'relation' && gdf.relationType === 'one-to-many'));
          const grandEditableCols = grandCols.map((gdf) => {
            if (gdf.type === 'relation' && gdf.relationTable) {
              const relDisplay = gdf.relationDisplayField || 'name';
              const relFetchFn = `get${toPascalCase(singularize(gdf.relationTable))}Options`;
              return `              {
                title: '${gdf.description || gdf.name}',
                dataIndex: '${gdf.name}',
                valueType: 'select',
                render: (_: any, r: any) => r.${gdf.name}_display || r.${gdf.name},
                formItemProps: { rules: [{ required: ${gdf.required} }] },
                request: async () => { const res = await ${relFetchFn}(); return res.map((item: any) => ({ label: item.${relDisplay}, value: item.id })); },
                fieldProps: { showSearch: true },
              },`;
            }
            if (gdf.type === 'dict' && gdf.dictType) {
              return `              {
                title: '${gdf.description || gdf.name}',
                dataIndex: '${gdf.name}',
                valueType: 'select',
                formItemProps: { rules: [{ required: ${gdf.required} }] },
                request: async () => { const list = await getDictDetailsByType('${gdf.dictType}'); return list.map((item: any) => ({ label: item.label, value: item.value })); },
              },`;
            }
            return `              {
                title: '${gdf.description || gdf.name}',
                dataIndex: '${gdf.name}',
                valueType: '${gdf.type === 'integer' || gdf.type === 'bigint' || gdf.type === 'decimal' ? 'digit' : gdf.type === 'timestamp' ? 'dateTime' : 'text'}',
                formItemProps: { rules: [{ required: ${gdf.required} }] },
              },`;
          });
          const grandEmptyRow = grandCols.map(gdf => {
            if (gdf.type === 'relation') return `${gdf.name}: ''`;
            return `${gdf.name}: ${gdf.type === 'integer' || gdf.type === 'bigint' || gdf.type === 'decimal' ? '0' : gdf.type === 'timestamp' ? 'null' : "''"}`;
          }).join(', ');

          const compName = `${toPascalCase(singularize(dto.tableName))}${toPascalCase(singularize(f.name))}${toPascalCase(singularize(gf.name))}Editor`;
          grandchildSubComponents.push(`
function ${compName}({ row, form }: { row: any; form: any }) {
  const grandRows: any[] = row.${gf.name} || [];
  const [grandKeys, setGrandKeys] = useState<React.Key[]>(() => grandRows.map((r: any) => r.id));
  return (
    <>
      <EditableProTable<${grandPascalType}>
        rowKey="id"
        size="small"
        value={grandRows}
        onChange={(data) => {
          const cur: any[] = form.getFieldValue('${f.name}') || [];
          form.setFieldValue('${f.name}', cur.map((r: any) => r.id === row.id ? { ...r, ${gf.name}: data ?? [] } : r));
        }}
        recordCreatorProps={false}
        editable={{
          type: 'multiple',
          editableKeys: grandKeys,
          onChange: setGrandKeys,
          onValuesChange: (_r, ds) => {
            const cur: any[] = form.getFieldValue('${f.name}') || [];
            form.setFieldValue('${f.name}', cur.map((r: any) => r.id === row.id ? { ...r, ${gf.name}: ds } : r));
          },
          actionRender: (grandRow, _cfg, _doms) => [
            <a key="del" onClick={() => {
              const cur: any[] = form.getFieldValue('${f.name}') || [];
              form.setFieldValue('${f.name}', cur.map((r: any) => r.id === row.id ? { ...r, ${gf.name}: (r.${gf.name} || []).filter((g: any) => g.id !== grandRow.id) } : r));
              setGrandKeys((ks: React.Key[]) => ks.filter((k) => k !== grandRow.id));
            }} style={{ color: '#ff4d4f' }}>删除</a>,
          ],
        }}
        columns={[
${grandEditableCols.join('\n')}
          { title: '操作', valueType: 'option', width: 60 },
        ]}
      />
      <Button type="dashed" size="small" block icon={<PlusOutlined />} style={{ marginTop: 4 }} onClick={() => {
        const tempId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8);
        const newGrand = { id: tempId, ${grandEmptyRow} };
        const cur: any[] = form.getFieldValue('${f.name}') || [];
        form.setFieldValue('${f.name}', cur.map((r: any) => r.id === row.id ? { ...r, ${gf.name}: [...(r.${gf.name} || []), newGrand] } : r));
        setGrandKeys((ks: React.Key[]) => [...ks, tempId]);
      }}>添加${gf.description || gf.name}</Button>
    </>
  );
}
`);
          return `            {
              title: '${gf.description || gf.name}',
              dataIndex: '${gf.name}',
              editable: () => false,
              render: (_: any, row: any) => <${compName} row={row} form={form} />,
            },`;
        });

        return `          <Form.Item name="${f.name}" label="${f.description || f.name}">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('${f.name}') || [];
                return (
                  <>
                    <EditableProTable<${childPascalType}>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('${f.name}', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: ${toCamelCase(f.name)}EditableKeys,
                        onChange: set${toPascalCase(f.name)}EditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('${f.name}', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('${f.name}') || [];
                            form.setFieldValue('${f.name}', cur.filter((r: any) => r.id !== row.id));
                            set${toPascalCase(f.name)}EditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
${editableColumns.join('\n')}
${grandchildColumnDefs.join('\n')}
                        { title: '操作', valueType: 'option', width: 60 },
                      ]}
                    />
                    <Button
                      type="dashed"
                      block
                      icon={<PlusOutlined />}
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        const tempId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8);
                        const newRow = { id: tempId, ${emptyRow} };
                        form.setFieldValue('${f.name}', [...rows, newRow]);
                        set${toPascalCase(f.name)}EditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加${f.description || f.name}
                    </Button>
                  </>
                );
              }}
            </Form.Item>
          </Form.Item>`;
      }

      const targetNames = deriveNames(f.relationTable!);
      const fetchFunctionName = `get${toPascalCase(singularize(f.relationTable!))}Options`;
      const displayField = f.relationDisplayField || 'name';

      return `          <${component}
            name="${f.name}"
            label="${f.description || f.name}"
            ${requiredRule}
            request={async () => {
              const res = await ${fetchFunctionName}();
              return res.map((item: any) => ({ label: item.${displayField}, value: item.id }));
            }}
          />`;
    }
    if (f.type === 'dict') {
      const requiredRuleDict = f.required ? `rules={[{ required: true, message: '请选择${f.description || f.name}' }]}` : '';
      return `          <ProFormSelect
            name="${f.name}"
            label="${f.description || f.name}"
            ${requiredRuleDict}
            request={async () => {
              const list = await getDictDetailsByType('${f.dictType || ''}');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />`;
    }
    if (f.type === 'boolean') {
      return `          <${component}
            name="${f.name}"
            label="${f.description || f.name}"
          />`;
    }
    if (f.type === 'image') {
      return `          <Form.Item
            name="${f.name}"
            label="${f.description || f.name}"
            ${requiredRule}
            getValueFromEvent={(e) => {
              if (Array.isArray(e)) return e;
              return e?.fileList;
            }}
          >
            <Upload
              listType="picture-card"
              accept="image/*"
              maxCount={1}
              customRequest={async ({ file, onSuccess, onError }) => {
                try {
                  const result = await uploadFile(file as File);
                  onSuccess(result);
                } catch (err) {
                  onError(err);
                }
              }}
            >
              <div><PlusOutlined /> Upload</div>
            </Upload>
          </Form.Item>`;
    }
    if (f.type === 'file') {
      return `          <Form.Item
            name="${f.name}"
            label="${f.description || f.name}"
            ${requiredRule}
            getValueFromEvent={(e) => {
              if (Array.isArray(e)) return e;
              return e?.fileList;
            }}
          >
            <Upload
              listType="text"
              maxCount={1}
              customRequest={async ({ file, onSuccess, onError }) => {
                try {
                  const result = await uploadFile(file as File);
                  onSuccess(result);
                } catch (err) {
                  onError(err);
                }
              }}
            >
              <Button icon={<UploadOutlined />}>Select File</Button>
            </Upload>
          </Form.Item>`;
    }
    if (f.type === 'point') {
      return `          <Form.Item
            name="${f.name}"
            label="${f.description || f.name}"
            ${requiredRule}
          >
            <GeoField mode="picker" />
          </Form.Item>`;
    }
    if (f.type === 'text') {
      return `          <${component}
            name="${f.name}"
            label="${f.description || f.name}"
            placeholder="${f.description || f.name}"
            ${requiredRule}
            ${disabledWhenEditing}
            fieldProps={{ rows: 3 }}
          />`;
    }
    return `          <${component}
            name="${f.name}"
            label="${f.description || f.name}"
            placeholder="${f.description || f.name}"
            ${requiredRule}
            ${disabledWhenEditing}
          />`;
  });
  return { formFields, grandchildSubComponents };
}

/** Render form field list, wrapping multiple O2M fields in Tabs when needed. */
function buildModalFormBody(formFields: string[], creatableFields: AutoCodeField[]): string {
  const nonDetailFields = formFields.filter((_, i) => {
    const f = creatableFields[i];
    return !(f?.type === 'relation' && f?.relationType === 'one-to-many');
  });
  const detailFormFields = formFields.filter((_, i) => {
    const f = creatableFields[i];
    return f?.type === 'relation' && f?.relationType === 'one-to-many';
  });
  const detailFieldDefs = creatableFields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many');

  if (detailFormFields.length <= 1) {
    return formFields.join('\n\n');
  }
  const tabItems = detailFieldDefs.map((f, i) => `          {
            key: '${f.name}',
            label: '${f.description || f.name}',
            forceRender: true,
            children: (
${detailFormFields[i]}
            ),
          }`).join(',\n');
  return `${nonDetailFields.join('\n\n')}

          <Tabs
            items={[
${tabItems}
            ]}
          />`;
}

/**
 * Build the expandedRowRender JSX string for ProTable expandable rows.
 * Returns a single <Table/> for one O2M field, or <Tabs/> for multiple.
 */
function buildExpandedRowRender(
  oneToManyFields: AutoCodeField[],
  dto: AutoCodeDto,
): string {
  if (oneToManyFields.length === 1) {
    const f0 = oneToManyFields[0];
    const f0DisplayCols = f0.detailFields!.filter(df => df.name !== 'id' && !(df.type === 'relation' && df.relationTable === dto.tableName) && !(df.type === 'relation' && df.relationType === 'one-to-many'));
    const f0GrandFields = f0.detailFields!.filter(df => df.type === 'relation' && df.relationType === 'one-to-many' && df.detailFields && df.detailFields.length > 0);
    const grandExpandable = f0GrandFields.length > 0 ? `
              expandable={{
                rowExpandable: (r) => ${f0GrandFields.map(gf => `(r.${gf.name}?.length ?? 0) > 0`).join(' || ')},
                expandedRowRender: (childRow) => (
                  ${f0GrandFields.length === 1 ? `<Table size="small" rowKey="id" dataSource={childRow.${f0GrandFields[0].name} || []} pagination={false}
                    columns={[${(f0GrandFields[0].detailFields || []).filter(gdf => gdf.name !== 'id').map(gdf => `{ title: '${gdf.description || gdf.name}', dataIndex: '${gdf.name}' }`).join(', ')}]}
                    style={{ margin: '0 24px' }} />` : `<Tabs style={{ margin: '0 24px' }} items={[${f0GrandFields.map(gf => `{ key: '${gf.name}', label: '${gf.description || gf.name}', children: <Table size="small" rowKey="id" dataSource={childRow.${gf.name} || []} pagination={false} columns={[${(gf.detailFields || []).filter(gdf => gdf.name !== 'id').map(gdf => `{ title: '${gdf.description || gdf.name}', dataIndex: '${gdf.name}' }`).join(', ')}]} /> }`).join(', ')}]} />`}
                ),
              }}` : '';
    return `<Table
              size="small"
              rowKey="id"
              dataSource={record.${f0.name} || []}
              pagination={false}${grandExpandable}
              columns={[
                ${f0DisplayCols.map(df => (df.type === 'relation' ? `{ title: '${df.description || df.name}', dataIndex: '${df.name}', render: (_: any, r: any) => r.${df.name}_display || r.${df.name} }` : `{ title: '${df.description || df.name}', dataIndex: '${df.name}' }`)).join(',\n                ')},
              ]}
              style={{ margin: '0 48px' }}
            />`;
  }
  return `<Tabs
              style={{ margin: '0 48px' }}
              items={[
                ${oneToManyFields.map(f => {
                  const displayCols = f.detailFields!.filter(df => df.name !== 'id' && !(df.type === 'relation' && df.relationTable === dto.tableName) && !(df.type === 'relation' && df.relationType === 'one-to-many'));
                  const grandFields = f.detailFields!.filter(df => df.type === 'relation' && df.relationType === 'one-to-many' && df.detailFields && df.detailFields.length > 0);
                  const grandExpandable2 = grandFields.length > 0 ? `
                    expandable={{ rowExpandable: (r) => ${grandFields.map(gf => `(r.${gf.name}?.length ?? 0) > 0`).join(' || ')}, expandedRowRender: (cr) => (${grandFields.length === 1 ? `<Table size="small" rowKey="id" dataSource={cr.${grandFields[0].name} || []} pagination={false} columns={[${(grandFields[0].detailFields || []).filter(gdf => gdf.name !== 'id').map(gdf => `{ title: '${gdf.description || gdf.name}', dataIndex: '${gdf.name}' }`).join(', ')}]} />` : `<Tabs items={[${grandFields.map(gf => `{ key: '${gf.name}', label: '${gf.description || gf.name}', children: <Table size="small" rowKey="id" dataSource={cr.${gf.name} || []} pagination={false} columns={[${(gf.detailFields || []).filter(gdf => gdf.name !== 'id').map(gdf => `{ title: '${gdf.description || gdf.name}', dataIndex: '${gdf.name}' }`).join(', ')}]} /> }`).join(', ')}]} />`}) }}` : '';
                  return `{
                  key: '${f.name}',
                  label: '${f.description || f.name}',
                  children: (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={record.${f.name} || []}
                      pagination={false}${grandExpandable2}
                      columns={[
                        ${displayCols.map(df => (df.type === 'relation' ? `{ title: '${df.description || df.name}', dataIndex: '${df.name}', render: (_: any, r: any) => r.${df.name}_display || r.${df.name} }` : `{ title: '${df.description || df.name}', dataIndex: '${df.name}' }`)).join(',\n                        ')},
                      ]}
                    />
                  ),
                }`;
                }).join(',\n                ')}
              ]}
            />`;
}

/**
 * Generate Umi 4 frontend page with ProTable + ModalForm.
 */
export function generateFrontendPage(dto: AutoCodeDto, relationDictTypes: Map<string, string | null> = new Map()): string {
  const n = deriveNames(dto.tableName);
  const listableFields = dto.fields.filter((f) => f.listable);
  const creatableFields = dto.fields.filter((f) => f.creatable);
  const editableFields = dto.fields.filter((f) => f.editable);
  const searchableFields = dto.fields.filter((f) => f.searchable);
  const relationFields = dto.fields.filter((f) => f.type === 'relation');

  const hasSelfRef = dto.fields.some(
    (f) => f.type === 'relation' && f.relationType === 'many-to-one' && f.relationTable === dto.tableName,
  );

  const columnLines = buildColumns(listableFields, dto, relationDictTypes);

  const { formFields, grandchildSubComponents } = buildFormFields(creatableFields, dto);

  // Exclude one-to-many relations from table search params (no search UI for sub-tables)
  const tableSearchableFields = searchableFields.filter((f) => !(f.type === 'relation' && f.relationType === 'one-to-many'));

  // Handle submit: build DTO
  // 'code' fields are auto-generated server-side; 'calculated' fields are virtual
  // (computed on read) — neither is ever submitted, so exclude from create/update DTOs.
  const createDtoFields = creatableFields.filter((f) => f.type !== 'code' && f.type !== 'calculated').map(buildDtoFieldTemplate);
  // 'code' fields are never submitted in update DTO (they are immutable after creation)
  const updateDtoFields = editableFields.filter((f) => f.type !== 'code' && f.type !== 'calculated').map(buildDtoFieldTemplate);

  const apiFunctions = [
    `get${n.pascalName}List`,
    `get${n.pascalSingular}`,
    `create${n.pascalSingular}`,
    `update${n.pascalSingular}`,
    `delete${n.pascalSingular}`,
    `batchDelete${n.pascalName}`,
    ...(dto.approvalFlow?.enabled ? [`submit${n.pascalSingular}Approval`] : []),
    ...(hasSelfRef ? [`get${n.pascalName}Tree`] : []),
  ];
  const typeImports = [
    `${n.pascalSingular}`,
    `Create${n.pascalSingular}Dto`,
    `Update${n.pascalSingular}Dto`,
  ];
  // Detail (child) types for one-to-many relations must be imported alongside the main
  // types — otherwise the generated page references <EditableProTable<XxxDetail>> without
  // the import (recurring "Cannot find name 'XxxDetail'" tsc error). Mirrors the
  // childPascalType logic used when rendering the EditableProTable below.
  for (const f of dto.fields) {
    if (f.type === 'relation' && f.relationType === 'one-to-many' && f.detailFields && f.detailFields.length > 0) {
      const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
      const childPascalType = isExisting
        ? deriveNames(f.relationTable!).schemaType
        : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);
      typeImports.push(childPascalType);
      // Grandchild types
      for (const gf of (f.detailFields || [])) {
        if (gf.type === 'relation' && gf.relationType === 'one-to-many' && gf.detailFields && gf.detailFields.length > 0) {
          const grandPascalType = toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}_${singularize(gf.name)}`);
          typeImports.push(grandPascalType);
        }
      }
    }
  }

  for (const f of relationFields) {
    if (f.relationTable) {
      apiFunctions.push(`get${toPascalCase(singularize(f.relationTable))}Options`);
    }
  }

  const dictFields = dto.fields.filter((f) => f.type === 'dict');
  const needsProFormSelect = creatableFields.some((f) => (f.type === 'relation' && f.relationType !== 'one-to-many') || f.type === 'dict');
  const hasTopLevelTimestampFields = creatableFields.some((f) => f.type === 'timestamp');
  const needsDateTimePicker = hasTopLevelTimestampFields;

  const hasOneToMany = creatableFields.some((f) => f.type === 'relation' && f.relationType === 'one-to-many');

  const needsDayjs = hasTopLevelTimestampFields ||
    (hasOneToMany && dto.fields.some((f: any) => f.type === 'relation' && f.relationType === 'one-to-many' && (f.detailFields || []).some((df: any) => df.type === 'timestamp' || (df.type === 'relation' && df.relationType === 'one-to-many' && (df.detailFields || []).some((gdf: any) => gdf.type === 'timestamp')))));
  const manyToOneDictFields = dto.fields
    .filter((f) => f.type === 'relation' && (f.relationType === 'many-to-one' || f.relationType === 'many-to-many') && relationDictTypes.get(f.name))
    .map((f) => ({ field: f, dictType: relationDictTypes.get(f.name) as string }));
  const hasChildDictFields = dto.fields.some(
    (f) => f.type === 'relation' && f.relationType === 'one-to-many' &&
      (f.detailFields || []).some((df) => df.type === 'dict' && df.dictType),
  );
  const hasDictFields = dictFields.length > 0 || manyToOneDictFields.length > 0 || hasChildDictFields;

  const hasUploadFields = creatableFields.some((f) => f.type === 'image' || f.type === 'file');
  const hasPointFields = dto.fields.some((f) => f.type === 'point');

  const oneToManyFields = dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many' && f.detailFields && f.detailFields.length > 0);
  const antdImports = ['Button', 'message', 'Popconfirm', 'Space', 'Form', 'Table', 'Input'];
  if (hasSelfRef) antdImports.push('Card', 'Tag');
  if (hasUploadFields) antdImports.push('Upload');
  if (dto.fields.some((f) => f.type === 'image')) antdImports.push('Image');
  const needsTabsForExpand = oneToManyFields.length > 1 || oneToManyFields.some(f => f.detailFields!.filter(df => df.type === 'relation' && df.relationType === 'one-to-many' && df.detailFields && df.detailFields.length > 0).length > 1);
  if (needsTabsForExpand) antdImports.push('Tabs');
  const _descText = dto.description || n.pascalName;
  const _parenIdx = _descText.indexOf('（');
  const _parenAsciiIdx = _descText.indexOf('(');
  const _splitIdx = _parenIdx > 0 ? _parenIdx : (_parenAsciiIdx > 0 ? _parenAsciiIdx : -1);
  const headerShortName = _splitIdx > 0 ? _descText.slice(0, _splitIdx).trim() : _descText;
  const headerTooltip = _splitIdx > 0 ? _descText.slice(_splitIdx + 1).replace(/[）)]\s*$/, '').trim() : '';
  if (headerTooltip) antdImports.push('Tooltip');
  const headerTitleAttr = headerTooltip
    ? `headerTitle={<Tooltip title="${headerTooltip}"><span>${headerShortName}</span></Tooltip>}`
    : `headerTitle="${headerShortName}"`;
  for (const f2 of oneToManyFields) {
    for (const df of (f2.detailFields || [])) {
      if (df.type === 'relation' && df.relationType === 'one-to-many' && df.detailFields) {
        // Grandchild FK relations
        for (const gdf of df.detailFields) {
          if (gdf.type === 'relation' && gdf.relationTable && gdf.relationTable !== dto.tableName) {
            const grandOptFn = `get${toPascalCase(singularize(gdf.relationTable))}Options`;
            if (!apiFunctions.includes(grandOptFn)) apiFunctions.push(grandOptFn);
          }
        }
        continue;
      }
      if (df.type === 'relation' && df.relationTable && df.relationTable !== dto.tableName) {
        const childOptFn = `get${toPascalCase(singularize(df.relationTable))}Options`;
        if (!apiFunctions.includes(childOptFn)) apiFunctions.push(childOptFn);
      }
    }
  }

  const iconImports = ['PlusOutlined', 'SearchOutlined'];
  if (hasUploadFields) {
    iconImports.push('UploadOutlined');
  }
  if (dto.agentConfig?.enabled) {
    iconImports.push('RobotOutlined');
  }

  return `import React, { useRef, useState, useEffect, useCallback } from 'react';
import { history } from 'umi';
${needsDayjs ? "import dayjs from 'dayjs';\n" : ''}import { ${antdImports.join(', ')} } from 'antd';
import { ${iconImports.join(', ')} } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable${hasOneToMany ? ', EditableProTable' : ''} } from '@ant-design/pro-components';
import {
  ModalForm,
  ProFormText,
  ProFormTextArea,
  ProFormDigit,
  ProFormSwitch,${needsProFormSelect ? '\n  ProFormSelect,' : ''}${needsDateTimePicker ? '\n  ProFormDateTimePicker,' : ''}
} from '@ant-design/pro-components';
import {
  ${apiFunctions.join(',\n  ')},
  type ${typeImports.join(',\n  type ')},
} from '${n.serviceImportAlias}';
${dto.approvalFlow?.enabled ? `import ReassignModal from '@/components/ReassignModal';` : ''}${dto.visibilityStrategy === 'shared' ? `
import ShareModal from '@/components/ShareModal';` : ''}${dto.agentConfig?.enabled ? `
import EntityAgentPanel from '@/components/EntityAgentPanel';` : ''}
import { getMyBtnPerms, type CustomBtnEntry } from '@/services/authority-btn';${hasUploadFields ? `\nimport { uploadFile } from '@/services/file';` : ''}${hasDictFields ? `\nimport { getDictDetailsByType } from '@/services/dictionary';` : ''}${hasPointFields ? `\nimport GeoField from '@/components/GeoField';` : ''}

${grandchildSubComponents.join('')}
export default function ${n.pascalName}Page() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<${n.pascalSingular} | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);${dto.approvalFlow?.enabled ? `
  const [reassignOpen, setReassignOpen] = useState(false);` : ''}${dto.visibilityStrategy === 'shared' ? `
  const [shareOpen, setShareOpen] = useState(false);` : ''}${dto.agentConfig?.enabled ? `
  const [agentOpen, setAgentOpen] = useState(false);` : ''}
  const [form] = Form.useForm();${hasSelfRef ? `
  const [treeData, setTreeData] = useState<any[]>([]);
  const [isHierarchical, setIsHierarchical] = useState(false);
  const loadTree = useCallback(async () => {
    try {
      const data = await get${n.pascalName}Tree();
      setTreeData(data);
      setIsHierarchical(data.some((n: any) => n.children && n.children.length > 0));
    } catch { setTreeData([]); setIsHierarchical(false); }
  }, []);
  useEffect(() => { loadTree(); }, [loadTree]);` : ''}
${hasOneToMany ? `${dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many').map(f => `  const [${toCamelCase(f.name)}EditableKeys, set${toPascalCase(f.name)}EditableKeys] = useState<React.Key[]>([]);`).join('\n')}\n  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);\n  const currentDataRef = useRef<${n.pascalSingular}[]>([]);\n` : ''}${dictFields.length > 0 ? dictFields.map(f => `  const [${toCamelCase(f.name)}Options, set${toPascalCase(f.name)}Options] = useState<Record<string, { text: string }>>({});`).join('\n') + '\n' : ''}${manyToOneDictFields.length > 0 ? manyToOneDictFields.map(({ field: f }) => `  const [${toCamelCase(f.name)}TypeMap, set${toPascalCase(f.name)}TypeMap] = useState<Record<string, string>>({});`).join('\n') + '\n' : ''}${tableSearchableFields.flatMap(f => (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal') ? [`  const [search${toPascalCase(f.name)}Min, setSearch${toPascalCase(f.name)}Min] = useState('');`, `  const [search${toPascalCase(f.name)}Max, setSearch${toPascalCase(f.name)}Max] = useState('');`] : [`  const [search${toPascalCase(f.name)}, setSearch${toPascalCase(f.name)}] = useState('');`]).join('\n')}${tableSearchableFields.length > 0 ? `
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); }, []);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);
` : ''}${hasDictFields ? `
  useEffect(() => {
${dictFields.map(f => `    getDictDetailsByType('${f.dictType || ''}').then((list: any[]) => {
      const map: Record<string, { text: string }> = {};
      list.forEach((item: any) => { map[item.value] = { text: item.label }; });
      set${toPascalCase(f.name)}Options(map);
    }).catch(() => {});`).join('\n')}
${manyToOneDictFields.map(({ field: f, dictType }) => `    getDictDetailsByType('${dictType}').then((list: any[]) => {
      const m: Record<string, string> = {};
      list.forEach((item: any) => { m[item.value] = item.label; });
      set${toPascalCase(f.name)}TypeMap(m);
    }).catch(() => {});`).join('\n')}
  }, []);
` : ''}
  // ── Button-level permission check ──
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  const [customBtns, setCustomBtns] = useState<CustomBtnEntry[]>([]);
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      const entry = perms['${n.pageComponentPath}'];
      setBtnPerms(new Set(entry?.systemBtns ?? []));
      setCustomBtns(entry?.customBtns ?? []);
    }).catch(() => {});
  }, []);

  // ── Jump-to-record: if ?id= param present, open that record in modal ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jumpId = params.get('id');
    if (!jumpId) return;
    get${n.pascalSingular}(jumpId).then((record) => {
      form.setFieldsValue(record);
      setEditingRecord(record);
      setModalOpen(true);
    }).catch(() => {});
  }, []);

  const columns: ProColumns<${n.pascalSingular}>[] = [
${columnLines.join('\n')}
    {
      title: '操作',
      key: 'action',
      width: 140,
      search: false,
      render: (_, record) => (
        <Space>
          {btnPerms.has('edit') && (
            <Button
              type="link"
              size="small"
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({
                  ${creatableFields.map(f => {
                    if (f.type === 'relation' && f.relationType === 'one-to-many') {
                      const tsFields = (f.detailFields || []).filter((df: any) => df.type === 'timestamp' && df.name !== 'id');
                      if (tsFields.length > 0) {
                        const tsConversions = tsFields.map((df: any) => `${df.name}: d.${df.name} ? dayjs(d.${df.name}) : null`).join(', ');
                        return `${f.name}: (record.${f.name} || []).map((d: any) => ({ ...d, ${tsConversions} })),`;
                      }
                      return `${f.name}: record.${f.name} || [],`;
                    }
                    if (f.type === 'image' || f.type === 'file') {
                      return `${f.name}: record.${f.name} ? [{ uid: '-1', name: 'file', url: record.${f.name}, status: 'done' }] : [],`;
                    }
                    if (f.type === 'timestamp') {
                      return `${f.name}: record.${f.name} ? dayjs(record.${f.name}) : null,`;
                    }
                    return `${f.name}: record.${f.name},`;
                  }).join('\n                  ')}
                });
                setEditingRecord(record);
                ${hasOneToMany ? dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many').map(f => `set${toPascalCase(f.name)}EditableKeys((record.${f.name} || []).map((d: any) => d.id));`).join('\n                ') : ''}
                setModalOpen(true);
              }}
            >
              编辑
            </Button>
          )}
          {btnPerms.has('delete') && (
            <Popconfirm
              title="确认删除？"
              description="删除后无法恢复。"
              onConfirm={async () => {
                try {
                  await delete${n.pascalSingular}(record.id);
                  message.success('删除成功');
                  actionRef.current?.reload();${hasSelfRef ? `
                  loadTree();` : ''}
                } catch (err: any) {
                  message.error(err.message || '删除失败');
                }
              }}
              okText="确认"
              cancelText="取消"
            >
              <Button type="link" size="small" danger>
                删除
              </Button>
            </Popconfirm>
          )}
          ${dto.approvalFlow?.enabled ? `<Button
            type="link"
            size="small"
            onClick={async () => {
              try {
                await submit${n.pascalSingular}Approval(record.id, record);
                message.success('已提交审批');
                actionRef.current?.reload();
              } catch (err: any) {
                message.error(err.message || '提交审批失败');
              }
            }}
          >
            提交审批
          </Button>
          ` : ''}
          {customBtns.map((btn) => (
            <Button
              key={btn.name}
              type="link"
              size="small"
              onClick={() => {
                const targetId = (record as any)[btn.sourceField];
                if (targetId) {
                  history.push(\`/lc/\${btn.targetTable}?id=\${targetId}\`);
                }
              }}
            >
              {btn.label}
            </Button>
          ))}
        </Space>
      ),
    },
  ];

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      if (editingRecord) {
        const dto: Update${n.pascalSingular}Dto = {
${updateDtoFields.join('\n')}
        };
        await update${n.pascalSingular}(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: Create${n.pascalSingular}Dto = {
${createDtoFields.join('\n')}
        };
        await create${n.pascalSingular}(dto);
        message.success('创建成功');
      }
      setModalOpen(false);
      setEditingRecord(null);
      actionRef.current?.reload();${hasSelfRef ? `
      loadTree();` : ''}
      return true;
    } catch (err: any) {
      message.error(err.message || '操作失败');
      return false;
    }
  };

  const handleBatchDelete = async () => {
    try {
      const result = await batchDelete${n.pascalName}(selectedRowKeys);
      message.success(\`成功删除 \$\{result.count\} 条记录\`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();${hasSelfRef ? `
      loadTree();` : ''}
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>${hasSelfRef ? `
      {isHierarchical && (
        <Card
          title="${headerShortName}"
          style={{ marginBottom: 16 }}
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingRecord(null); setModalOpen(true); }}>
              新建
            </Button>
          }
        >
          <Table<${n.pascalSingular}>
            rowKey="id"
            dataSource={treeData}
            columns={columns}
            pagination={false}
            size="small"
            expandable={{ defaultExpandAllRows: false }}
            rowClassName={(record: any) => record.${toCamelCase(dto.fields.find(f => f.type === 'relation' && f.relationType === 'many-to-one' && f.relationTable === dto.tableName)?.name || 'parentId')} ? '' : 'tree-row-root'}
          />
          <style>{\`
            .tree-row-root td { background: #f0f5ff !important; font-weight: 500; }
            .tree-row-root:hover td { background: #d6e4ff !important; }
          \`}</style>
        </Card>
      )}
      {!isHierarchical && (` : ''}
      <ProTable<${n.pascalSingular}>
        ${headerTitleAttr}
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
${oneToManyFields.length > 0 ? `        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
          rowExpandable: (record) => ${oneToManyFields.map(f => `(record.${f.name}?.length ?? 0) > 0`).join(' || ')},
          expandedRowRender: (record) => (
            ${buildExpandedRowRender(oneToManyFields, dto)}
          ),
        }}` : ''}
        search={false}
        ${tableSearchableFields.length > 0 ? `params={{ ${tableSearchableFields.flatMap(f => (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal') ? [`search${toPascalCase(f.name)}Min`, `search${toPascalCase(f.name)}Max`] : [`search${toPascalCase(f.name)}`]).join(', ')} }}` : ''}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await get${n.pascalName}List({ page, pageSize${tableSearchableFields.length > 0 ? `, ${tableSearchableFields.flatMap(f => (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal') ? [`${f.name}Min: search${toPascalCase(f.name)}Min || undefined`, `${f.name}Max: search${toPascalCase(f.name)}Max || undefined`] : [`${f.name}: search${toPascalCase(f.name)} || undefined`]).join(', ')}` : ''} });
          ${oneToManyFields.length > 0 ? 'currentDataRef.current = result.list;\n          setExpandedRowKeys([]);' : ''}
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          ${oneToManyFields.length > 0 ? `<Button
            key="expand-all"
            size="small"
            onClick={() => {
              const expandable = currentDataRef.current
                .filter(r => ${oneToManyFields.map(f => `(r.${f.name}?.length ?? 0) > 0`).join(' || ')})
                .map(r => r.id);
              if (expandedRowKeys.length === expandable.length) {
                setExpandedRowKeys([]);
              } else {
                setExpandedRowKeys(expandable);
              }
            }}
          >
            {expandedRowKeys.length > 0 ? '折叠全部' : '展开全部'}
          </Button>,` : ''}
          ${tableSearchableFields.length > 0 ? '<Space key="filters" wrap size={8}>' : ''}
          ${tableSearchableFields.flatMap(f => (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal') ? [`<Input
            key="search-${f.name}-min"
            placeholder="${f.description || f.name}最小值"
            allowClear
            style={{ width: 120 }}
            onChange={makeDebounce(setSearch${toPascalCase(f.name)}Min)}
            onClear={() => setSearch${toPascalCase(f.name)}Min('')}
          />,`, `<Input
            key="search-${f.name}-max"
            placeholder="${f.description || f.name}最大值"
            allowClear
            style={{ width: 120 }}
            onChange={makeDebounce(setSearch${toPascalCase(f.name)}Max)}
            onClear={() => setSearch${toPascalCase(f.name)}Max('')}
          />,`] : [`<Input
            key="search-${f.name}"
            placeholder="搜索${f.description || f.name}"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearch${toPascalCase(f.name)})}
            onClear={() => setSearch${toPascalCase(f.name)}('')}
          />,`]).join('\n          ')}
          ${tableSearchableFields.length > 0 ? '</Space>,' : ''}
          btnPerms.has('add') && (
            <Button
              key="create"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setEditingRecord(null);
                ${hasOneToMany ? dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many').map(f => `set${toPascalCase(f.name)}EditableKeys([]);`).join('\n                ') : ''}
                setModalOpen(true);
              }}
            >
              新建
            </Button>
          ),
          btnPerms.has('batchDelete') && selectedRowKeys.length > 0 && (
            <Popconfirm
              key="batch-delete"
              title="确认批量删除？"
              description={\`已选择 \$\{selectedRowKeys.length\} 条记录，删除后无法恢复。\`}
              onConfirm={handleBatchDelete}
              okText="确认"
              cancelText="取消"
            >
              <Button danger>
                批量删除 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          ),
          ${dto.approvalFlow?.enabled ? `selectedRowKeys.length > 0 && (
            <Button
              key="reassign"
              onClick={() => setReassignOpen(true)}
            >
              移交 ({selectedRowKeys.length})
            </Button>
          ),` : ''}${dto.visibilityStrategy === 'shared' ? `
          selectedRowKeys.length > 0 && (
            <Button
              key="share"
              onClick={() => setShareOpen(true)}
            >
              共享 ({selectedRowKeys.length})
            </Button>
          ),` : ''}${dto.agentConfig?.enabled ? `
          btnPerms.has('agent') && (
            <Button
              key="agent"
              icon={<RobotOutlined />}
              onClick={() => setAgentOpen(true)}
            >
              AI 助手
            </Button>
          ),` : ''}
        ].filter(Boolean)}
      />${hasSelfRef ? `
      )}` : ''}

      <ModalForm
        title={editingRecord ? '编辑' : '新建'}
        open={modalOpen}
        form={form}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
${hasOneToMany ? dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many').map(f => `            set${toPascalCase(f.name)}EditableKeys([]);`).join('\n') + '\n' : ''}            setTimeout(() => setEditingRecord(null), 300);
          }
        }}
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
${buildModalFormBody(formFields, creatableFields)}
      </ModalForm>

      ${dto.approvalFlow?.enabled ? `<ReassignModal
        open={reassignOpen}
        businessType="${n.tableName}"
        ids={selectedRowKeys}
        onClose={() => setReassignOpen(false)}
        onSuccess={() => {
          setSelectedRowKeys([]);
          actionRef.current?.reload();
        }}
      />` : ''}${dto.visibilityStrategy === 'shared' ? `
      <ShareModal
        open={shareOpen}
        businessType="${n.tableName}"
        ids={selectedRowKeys}
        onClose={() => setShareOpen(false)}
        onSuccess={() => {
          setSelectedRowKeys([]);
          actionRef.current?.reload();
        }}
      />` : ''}${dto.agentConfig?.enabled ? `
      <EntityAgentPanel
        open={agentOpen}
        businessType="${n.tableName}"
        onClose={() => setAgentOpen(false)}
      />` : ''}
    </>
  );
}
`;
}

/**
 * Generate the list page for a document-type module.
 * Shows a ProTable with a "查看" button per row that navigates to the detail page.
 * No create modal — the toolbar "新建" button routes to /create instead.
 */
export function generateFrontendDocumentListPage(dto: AutoCodeDto, relationDictTypes: Map<string, string | null> = new Map()): string {
  const n = deriveNames(dto.tableName);
  const listableFields = dto.fields.filter((f) => f.listable && f.type !== 'relation' || (f.type === 'relation' && f.relationType !== 'one-to-many'));
  const searchableFields = dto.fields.filter((f) => f.searchable);
  const tableSearchableFields = searchableFields.filter((f) => !(f.type === 'relation' && f.relationType === 'one-to-many'));

  const hasSelfRef = dto.fields.some(
    (f) => f.type === 'relation' && f.relationType === 'many-to-one' && f.relationTable === dto.tableName,
  );
  const selfRefField = dto.fields.find(
    (f) => f.type === 'relation' && f.relationType === 'many-to-one' && f.relationTable === dto.tableName,
  );

  const dictFields = dto.fields.filter((f) => f.type === 'dict');
  const manyToOneDictFields = dto.fields
    .filter((f) => f.type === 'relation' && (f.relationType === 'many-to-one' || f.relationType === 'many-to-many') && relationDictTypes.get(f.name))
    .map((f) => ({ field: f, dictType: relationDictTypes.get(f.name) as string }));
  const hasDictFields = dictFields.length > 0 || manyToOneDictFields.length > 0;

  const columnLines = listableFields.map((f) => {
    if (f.type === 'boolean') {
      return `    { title: '${f.description || f.name}', dataIndex: '${f.name}', valueType: 'switch', width: 100, search: false },`;
    }
    if (f.type === 'image') {
      return `    { title: '${f.description || f.name}', dataIndex: '${f.name}', width: 80, search: false, render: (_, record) => record.${f.name} ? <Image src={record.${f.name}} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '-' },`;
    }
    if (f.type === 'dict') {
      return `    { title: '${f.description || f.name}', dataIndex: '${f.name}', valueType: 'select', width: 120, search: false, valueEnum: ${toCamelCase(f.name)}Options },`;
    }
    if (f.type === 'relation' && (f.relationType === 'many-to-one' || f.relationType === 'many-to-many')) {
      const m2oDictType = relationDictTypes.get(f.name);
      const renderExpr = m2oDictType
        ? `{ const code = record.${f.name}_display || record.${f.name}; return ${toCamelCase(f.name)}TypeMap[code ?? ''] ?? code; }`
        : `record.${f.name}_display || '-'`;
      return `    { title: '${f.description || f.name}', dataIndex: '${f.name}', width: 180, search: false, render: (_, record) => ${renderExpr} },`;
    }
    return `    { title: '${f.description || f.name}', dataIndex: '${f.name}', width: 180 },`;
  });

  const isNumericF = (f: AutoCodeField) => f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal';

  const _descText = dto.description || n.pascalName;
  const _parenIdx = _descText.indexOf('（');
  const _parenAsciiIdx = _descText.indexOf('(');
  const _splitIdx = _parenIdx > 0 ? _parenIdx : (_parenAsciiIdx > 0 ? _parenAsciiIdx : -1);
  const headerShortName = _splitIdx > 0 ? _descText.slice(0, _splitIdx).trim() : _descText;

  const antdImports = ['Button', 'message', 'Popconfirm', 'Space', 'Input'];
  if (hasSelfRef) antdImports.push('Table', 'Card');
  if (dto.fields.some((f) => f.type === 'image')) antdImports.push('Image');
  if (hasDictFields) antdImports.push('Tag');

  const iconImportsDL = ['PlusOutlined', 'SearchOutlined'];
  if (dto.agentConfig?.enabled) iconImportsDL.push('RobotOutlined');

  return `import React, { useRef, useState, useEffect, useCallback } from 'react';
import { history } from 'umi';
import { ${antdImports.join(', ')} } from 'antd';
import { ${iconImportsDL.join(', ')} } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  get${n.pascalName}List, delete${n.pascalSingular}, batchDelete${n.pascalName},${hasSelfRef ? `\n  get${n.pascalName}Tree,` : ''}
  type ${n.pascalSingular},
} from '${n.serviceImportAlias}';
import { getMyBtnPerms } from '@/services/authority-btn';${hasDictFields ? `\nimport { getDictDetailsByType } from '@/services/dictionary';` : ''}${dto.agentConfig?.enabled ? `\nimport EntityAgentPanel from '@/components/EntityAgentPanel';` : ''}

export default function ${n.pascalName}Page() {
  const actionRef = useRef<ActionType>(undefined);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());${dto.agentConfig?.enabled ? `
  const [agentOpen, setAgentOpen] = useState(false);` : ''}${hasSelfRef ? `
  const [treeData, setTreeData] = useState<any[]>([]);
  const [isHierarchical, setIsHierarchical] = useState(false);
  const loadTree = useCallback(async () => {
    try {
      const data = await get${n.pascalName}Tree();
      setTreeData(data);
      setIsHierarchical(data.some((n: any) => n.children && n.children.length > 0));
    } catch { setTreeData([]); setIsHierarchical(false); }
  }, []);
  useEffect(() => { loadTree(); }, [loadTree]);` : ''}
${dictFields.length > 0 ? dictFields.map(f => `  const [${toCamelCase(f.name)}Options, set${toPascalCase(f.name)}Options] = useState<Record<string, { text: string }>>({});`).join('\n') + '\n' : ''}${manyToOneDictFields.length > 0 ? manyToOneDictFields.map(({ field: f }) => `  const [${toCamelCase(f.name)}TypeMap, set${toPascalCase(f.name)}TypeMap] = useState<Record<string, string>>({});`).join('\n') + '\n' : ''}${tableSearchableFields.flatMap(f => isNumericF(f) ? [`  const [search${toPascalCase(f.name)}Min, setSearch${toPascalCase(f.name)}Min] = useState('');`, `  const [search${toPascalCase(f.name)}Max, setSearch${toPascalCase(f.name)}Max] = useState('');`] : [`  const [search${toPascalCase(f.name)}, setSearch${toPascalCase(f.name)}] = useState('');`]).join('\n')}${tableSearchableFields.length > 0 ? `
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); }, []);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);` : ''}
${hasDictFields ? `
  useEffect(() => {
${dictFields.map(f => `    getDictDetailsByType('${f.dictType || ''}').then((list: any[]) => {
      const map: Record<string, { text: string }> = {};
      list.forEach((item: any) => { map[item.value] = { text: item.label }; });
      set${toPascalCase(f.name)}Options(map);
    }).catch(() => {});`).join('\n')}
${manyToOneDictFields.map(({ field: f, dictType }) => `    getDictDetailsByType('${dictType}').then((list: any[]) => {
      const m: Record<string, string> = {};
      list.forEach((item: any) => { m[item.value] = item.label; });
      set${toPascalCase(f.name)}TypeMap(m);
    }).catch(() => {});`).join('\n')}
  }, []);` : ''}

  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      const entry = perms['${n.pageComponentPath}'];
      setBtnPerms(new Set(entry?.systemBtns ?? []));
    }).catch(() => {});
  }, []);

  const handleBatchDelete = async () => {
    try {
      const result = await batchDelete${n.pascalName}(selectedRowKeys);
      message.success(\`成功删除 \$\{result.count\} 条记录\`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();${hasSelfRef ? `
      loadTree();` : ''}
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  const columns: ProColumns<${n.pascalSingular}>[] = [
${columnLines.join('\n')}
    {
      title: '操作',
      key: 'action',
      width: 120,
      search: false,
      render: (_, record) => (
        <Space>
          {btnPerms.has('view') && (
            <Button type="link" size="small" onClick={() => history.push(\`/lc/${n.kebabName}/\${record.id}\`)}>
              查看
            </Button>
          )}
          {btnPerms.has('edit') && (
            <Button type="link" size="small" onClick={() => history.push(\`/lc/${n.kebabName}/\${record.id}\`)}>
              编辑
            </Button>
          )}
          {btnPerms.has('delete') && (
            <Popconfirm
              title="确认删除？"
              description="删除后无法恢复。"
              onConfirm={async () => {
                try {
                  await delete${n.pascalSingular}(record.id);
                  message.success('删除成功');
                  actionRef.current?.reload();${hasSelfRef ? `
                  loadTree();` : ''}
                } catch (err: any) {
                  message.error(err.message || '删除失败');
                }
              }}
              okText="确认"
              cancelText="取消"
            >
              <Button type="link" size="small" danger>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>${hasSelfRef ? `
      {isHierarchical && (
        <Card
          title="${headerShortName}"
          style={{ marginBottom: 16 }}
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => history.push('/lc/${n.kebabName}/create')}>
              新建
            </Button>
          }
        >
          <Table<${n.pascalSingular}>
            rowKey="id"
            dataSource={treeData}
            columns={columns}
            pagination={false}
            size="small"
            expandable={{ defaultExpandAllRows: false }}
            rowClassName={(record: any) => record.${toCamelCase(selfRefField?.name || 'parentId')} ? '' : 'tree-row-root'}
          />
          <style>{\`
            .tree-row-root td { background: #f0f5ff !important; font-weight: 500; }
            .tree-row-root:hover td { background: #d6e4ff !important; }
          \`}</style>
        </Card>
      )}
      {!isHierarchical && (` : ''}
      <ProTable<${n.pascalSingular}>
        headerTitle="${headerShortName}"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        search={false}
        ${tableSearchableFields.length > 0 ? `params={{ ${tableSearchableFields.flatMap(f => isNumericF(f) ? [`search${toPascalCase(f.name)}Min`, `search${toPascalCase(f.name)}Max`] : [`search${toPascalCase(f.name)}`]).join(', ')} }}` : ''}
        rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys as string[]) }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await get${n.pascalName}List({ page, pageSize${tableSearchableFields.length > 0 ? `, ${tableSearchableFields.flatMap(f => isNumericF(f) ? [`${f.name}Min: search${toPascalCase(f.name)}Min || undefined`, `${f.name}Max: search${toPascalCase(f.name)}Max || undefined`] : [`${f.name}: search${toPascalCase(f.name)} || undefined`]).join(', ')}` : ''} });
          return { data: result.list, total: result.total, success: true };
        }}
        toolBarRender={() => [
          ${tableSearchableFields.length > 0 ? `<Space key="filters" wrap size={8}>
            ${tableSearchableFields.flatMap(f => isNumericF(f) ? [`<Input key="search-${f.name}-min" placeholder="${f.description || f.name}最小值" allowClear style={{ width: 120 }} onChange={makeDebounce(setSearch${toPascalCase(f.name)}Min)} onClear={() => setSearch${toPascalCase(f.name)}Min('')} />`, `<Input key="search-${f.name}-max" placeholder="${f.description || f.name}最大值" allowClear style={{ width: 120 }} onChange={makeDebounce(setSearch${toPascalCase(f.name)}Max)} onClear={() => setSearch${toPascalCase(f.name)}Max('')} />`] : [`<Input key="search-${f.name}" placeholder="搜索${f.description || f.name}" prefix={<SearchOutlined />} allowClear style={{ width: 180 }} onChange={makeDebounce(setSearch${toPascalCase(f.name)})} onClear={() => setSearch${toPascalCase(f.name)}('')} />`]).join('\n            ')}
          </Space>,` : ''}
          btnPerms.has('add') && (
            <Button key="create" type="primary" icon={<PlusOutlined />} onClick={() => history.push('/lc/${n.kebabName}/create')}>
              新建
            </Button>
          ),
          btnPerms.has('batchDelete') && selectedRowKeys.length > 0 && (
            <Popconfirm
              key="batch-delete"
              title="确认批量删除？"
              description={\`已选择 \$\{selectedRowKeys.length\} 条记录，删除后无法恢复。\`}
              onConfirm={handleBatchDelete}
              okText="确认"
              cancelText="取消"
            >
              <Button danger>批量删除 ({selectedRowKeys.length})</Button>
            </Popconfirm>
          ),
          ${dto.agentConfig?.enabled ? `btnPerms.has('agent') && (
            <Button
              key="agent"
              icon={<RobotOutlined />}
              onClick={() => setAgentOpen(true)}
            >
              AI 助手
            </Button>
          ),` : ''}
        ].filter(Boolean)}
      />${hasSelfRef ? `
      )}` : ''}
      ${dto.agentConfig?.enabled ? `<EntityAgentPanel
        open={agentOpen}
        businessType="${n.tableName}"
        onClose={() => setAgentOpen(false)}
      />` : ''}
    </>
  );
}
`;
}

/**
 * Generate the document detail page (detail.tsx).
 * Layout: header form (non-O2M fields, 2-column grid) + one section per O2M field
 * with an inline EditableProTable.  Toolbar: 保存草稿 / 提交审批 / 返回列表.
 */
export function generateFrontendDocumentPage(dto: AutoCodeDto, relationDictTypes: Map<string, string | null> = new Map()): string {
  const n = deriveNames(dto.tableName);
  const headerFields = dto.fields.filter((f) => f.creatable && f.type !== 'calculated' && !(f.type === 'relation' && f.relationType === 'one-to-many'));
  const o2mFields = dto.fields.filter((f) => f.type === 'relation' && f.relationType === 'one-to-many' && f.detailFields && f.detailFields.length > 0);

  const dictFields = dto.fields.filter((f) => f.type === 'dict');
  const manyToOneDictFields = dto.fields
    .filter((f) => f.type === 'relation' && (f.relationType === 'many-to-one' || f.relationType === 'many-to-many') && relationDictTypes.get(f.name))
    .map((f) => ({ field: f, dictType: relationDictTypes.get(f.name) as string }));
  const hasDictFields = dictFields.length > 0 || manyToOneDictFields.length > 0 ||
    o2mFields.some(f => (f.detailFields || []).some(df => df.type === 'dict' && df.dictType));

  const hasUploadFields = headerFields.some((f) => f.type === 'image' || f.type === 'file');
  const hasPointHeaderFields = headerFields.some((f) => f.type === 'point');
  const hasTimestampFields = headerFields.some((f) => f.type === 'timestamp') ||
    o2mFields.some(f => (f.detailFields || []).some(df => df.type === 'timestamp'));

  const relationTables = new Set<string>();
  headerFields.filter(f => f.type === 'relation' && f.relationTable).forEach(f => relationTables.add(f.relationTable!));
  o2mFields.forEach(f => (f.detailFields || []).filter(df => df.type === 'relation' && df.relationTable && df.relationTable !== dto.tableName).forEach(df => relationTables.add(df.relationTable!)));

  const apiFunctions = [
    `get${n.pascalSingular}`,
    `create${n.pascalSingular}`,
    `update${n.pascalSingular}`,
    ...[...relationTables].map(t => `get${toPascalCase(singularize(t))}Options`),
    ...(dto.approvalFlow?.enabled ? [`submit${n.pascalSingular}Approval`] : []),
  ];

  const typeImports = [`Create${n.pascalSingular}Dto`, `Update${n.pascalSingular}Dto`, n.pascalSingular];
  for (const f of o2mFields) {
    const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
    const childType = isExisting ? deriveNames(f.relationTable!).schemaType : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);
    typeImports.push(childType);
  }

  // Header form fields JSX
  const headerFormItems = headerFields.map((f) => {
    const requiredRule = f.required ? `rules={[{ required: true, message: '请${f.type === 'relation' ? '选择' : '输入'}${f.description || f.name}' }]}` : '';
    const component = getProFormComponent(f);

    if (f.type === 'code') {
      return `            {isEditing && (
              <ProFormText name="${f.name}" label="${f.description || f.name}" disabled />
            )}`;
    }
    if (f.type === 'boolean') {
      return `            <ProFormSwitch name="${f.name}" label="${f.description || f.name}" />`;
    }
    if (f.type === 'dict') {
      return `            <ProFormSelect
              name="${f.name}"
              label="${f.description || f.name}"
              ${requiredRule}
              request={async () => { const list = await getDictDetailsByType('${f.dictType || ''}'); return list.map((d: any) => ({ label: d.label, value: d.value })); }}
            />`;
    }
    if (f.type === 'relation' && f.relationType !== 'one-to-many') {
      const fetchFn = `get${toPascalCase(singularize(f.relationTable!))}Options`;
      const displayField = f.relationDisplayField || 'name';
      return `            <ProFormSelect
              name="${f.name}"
              label="${f.description || f.name}"
              ${requiredRule}
              request={async () => { const res = await ${fetchFn}(); return res.map((item: any) => ({ label: item.${displayField}, value: item.id })); }}
            />`;
    }
    if (f.type === 'timestamp') {
      return `            <ProFormDateTimePicker name="${f.name}" label="${f.description || f.name}" ${requiredRule} />`;
    }
    if (f.type === 'image') {
      return `            <Form.Item name="${f.name}" label="${f.description || f.name}" ${requiredRule} getValueFromEvent={(e) => Array.isArray(e) ? e : e?.fileList}>
              <Upload listType="picture-card" accept="image/*" maxCount={1} customRequest={async ({ file, onSuccess, onError }) => { try { const r = await uploadFile(file as File); onSuccess(r); } catch (e) { onError(e); } }}>
                <div><PlusOutlined /> Upload</div>
              </Upload>
            </Form.Item>`;
    }
    if (f.type === 'file') {
      return `            <Form.Item name="${f.name}" label="${f.description || f.name}" ${requiredRule} getValueFromEvent={(e) => Array.isArray(e) ? e : e?.fileList}>
              <Upload listType="text" maxCount={1} customRequest={async ({ file, onSuccess, onError }) => { try { const r = await uploadFile(file as File); onSuccess(r); } catch (e) { onError(e); } }}>
                <Button icon={<UploadOutlined />}>选择文件</Button>
              </Upload>
            </Form.Item>`;
    }
    if (f.type === 'point') {
      return `            <Form.Item name="${f.name}" label="${f.description || f.name}" ${requiredRule}>
              <GeoField mode="picker" />
            </Form.Item>`;
    }
    if (f.type === 'text') {
      return `            <${component} name="${f.name}" label="${f.description || f.name}" placeholder="${f.description || f.name}" ${requiredRule} fieldProps={{ rows: 3 }} />`;
    }
    return `            <${component} name="${f.name}" label="${f.description || f.name}" placeholder="${f.description || f.name}" ${requiredRule} />`;
  });

  // O2M sections — each renders an EditableProTable card
  const o2mSections = o2mFields.map((f) => {
    const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
    const childType = isExisting ? deriveNames(f.relationTable!).schemaType : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);
    const detailCols = (f.detailFields || []).filter(df =>
      df.name !== 'id' &&
      !(df.type === 'relation' && df.relationTable === dto.tableName) &&
      !(df.type === 'relation' && df.relationType === 'one-to-many'),
    );
    const colDefs = detailCols.map((df) => {
      if (df.type === 'relation' && df.relationTable) {
        const relDisplay = df.relationDisplayField || 'name';
        const relFetchFn = `get${toPascalCase(singularize(df.relationTable))}Options`;
        return `          { title: '${df.description || df.name}', dataIndex: '${df.name}', valueType: 'select', render: (_: any, r: any) => r.${df.name}_display || r.${df.name}, formItemProps: { rules: [{ required: ${df.required} }] }, request: async () => { const res = await ${relFetchFn}(); return res.map((item: any) => ({ label: item.${relDisplay}, value: item.id })); }, fieldProps: { showSearch: true } },`;
      }
      if (df.type === 'dict' && df.dictType) {
        return `          { title: '${df.description || df.name}', dataIndex: '${df.name}', valueType: 'select', formItemProps: { rules: [{ required: ${df.required} }] }, request: async () => { const list = await getDictDetailsByType('${df.dictType}'); return list.map((item: any) => ({ label: item.label, value: item.value })); } },`;
      }
      const vt = df.type === 'integer' || df.type === 'bigint' || df.type === 'decimal' ? 'digit' : df.type === 'timestamp' ? 'dateTime' : 'text';
      return `          { title: '${df.description || df.name}', dataIndex: '${df.name}', valueType: '${vt}', formItemProps: { rules: [{ required: ${df.required} }] } },`;
    });
    const emptyRow = detailCols.map(df => {
      if (df.type === 'relation') return `${df.name}: ''`;
      return `${df.name}: ${df.type === 'integer' || df.type === 'bigint' || df.type === 'decimal' ? '0' : df.type === 'timestamp' ? 'null' : "''"}`;
    }).join(', ');

    return `        {/* ── ${f.description || f.name} ── */}
        <Card title="${f.description || f.name}" style={{ marginBottom: 16 }} extra={
          <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => {
            const tempId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8);
            const newRow = { id: tempId, ${emptyRow} };
            set${toPascalCase(f.name)}Rows((rows) => [...rows, newRow]);
            set${toPascalCase(f.name)}Keys((keys) => [...keys, tempId]);
          }}>添加行</Button>
        }>
          <EditableProTable<${childType}>
            rowKey="id"
            value={${toCamelCase(f.name)}Rows}
            onChange={(data) => set${toPascalCase(f.name)}Rows(data as ${childType}[])}
            recordCreatorProps={false}
            editable={{
              type: 'multiple',
              editableKeys: ${toCamelCase(f.name)}Keys,
              onChange: set${toPascalCase(f.name)}Keys,
              onValuesChange: (_record, dataSource) => set${toPascalCase(f.name)}Rows(dataSource as ${childType}[]),
              actionRender: (row, _cfg, _doms) => [
                <a key="del" onClick={() => {
                  set${toPascalCase(f.name)}Rows((rows) => rows.filter((r) => r.id !== row.id));
                  set${toPascalCase(f.name)}Keys((keys) => keys.filter((k) => k !== row.id));
                }} style={{ color: '#ff4d4f' }}>删除</a>,
              ],
            }}
            columns={[
${colDefs.join('\n')}
              { title: '操作', valueType: 'option', width: 60 },
            ]}
          />
        </Card>`;
  });

  // handleSubmit: build DTO
  const headerDtoFields = headerFields.filter(f => f.type !== 'code').map(buildDtoFieldTemplate);
  const o2mDtoFields = o2mFields.map(f => {
    const tsFields = (f.detailFields || []).filter((df: any) => df.type === 'timestamp' && df.name !== 'id');
    const tsOverrides = tsFields.map((df: any) => `            ${df.name}: d.${df.name} && typeof d.${df.name} === 'object' ? d.${df.name}.toISOString() : d.${df.name},`).join('\n');
    return `          ${f.name}: ${toCamelCase(f.name)}Rows.map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
${tsOverrides ? tsOverrides + '\n' : ''}          })),`;
  });

  const _descText = dto.description || n.pascalName;
  const _parenIdx = _descText.indexOf('（');
  const _parenAsciiIdx = _descText.indexOf('(');
  const _splitIdx = _parenIdx > 0 ? _parenIdx : (_parenAsciiIdx > 0 ? _parenAsciiIdx : -1);
  const headerShortName = _splitIdx > 0 ? _descText.slice(0, _splitIdx).trim() : _descText;

  const antdImports = ['Button', 'Card', 'Form', 'message', 'Space', 'Spin'];
  if (hasUploadFields) antdImports.push('Upload');

  const iconImports = ['PlusOutlined', 'ArrowLeftOutlined', 'SaveOutlined'];
  if (hasUploadFields) iconImports.push('UploadOutlined');
  if (dto.approvalFlow?.enabled) iconImports.push('CheckOutlined');

  return `import React, { useState, useEffect } from 'react';
import { history, useParams } from 'umi';
${hasTimestampFields ? "import dayjs from 'dayjs';\n" : ''}import { ${antdImports.join(', ')} } from 'antd';
import { ${iconImports.join(', ')} } from '@ant-design/icons';
import { ProForm, ProFormText, ProFormTextArea, ProFormDigit, ProFormSwitch, ProFormSelect, ProFormDateTimePicker, EditableProTable } from '@ant-design/pro-components';
import {
  ${apiFunctions.join(',\n  ')},
  type ${typeImports.join(',\n  type ')},
} from '${n.serviceImportAlias}';${hasPointHeaderFields ? `\nimport GeoField from '@/components/GeoField';` : ''}${hasDictFields ? `\nimport { getDictDetailsByType } from '@/services/dictionary';` : ''}${hasUploadFields ? `\nimport { uploadFile } from '@/services/file';` : ''}

export default function ${n.pascalName}DetailPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id && id !== 'create';
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
${o2mFields.map(f => {
  const isExisting = !!(f.relationExistingTable && f.relationTable && f.relationFkColumn);
  const childType = isExisting ? deriveNames(f.relationTable!).schemaType : toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}`);
  return `  const [${toCamelCase(f.name)}Rows, set${toPascalCase(f.name)}Rows] = useState<${childType}[]>([]);
  const [${toCamelCase(f.name)}Keys, set${toPascalCase(f.name)}Keys] = useState<React.Key[]>([]);`;
}).join('\n')}

  useEffect(() => {
    if (!isEditing) return;
    setLoading(true);
    get${n.pascalSingular}(id!).then((record) => {
      form.setFieldsValue({
        ${headerFields.map(f => {
          if (f.type === 'timestamp') return `${f.name}: record.${f.name} ? dayjs(record.${f.name}) : null,`;
          if (f.type === 'image' || f.type === 'file') return `${f.name}: record.${f.name} ? [{ uid: '-1', name: 'file', url: record.${f.name}, status: 'done' }] : [],`;
          return `${f.name}: record.${f.name},`;
        }).join('\n        ')}
      });
${o2mFields.map(f => `      set${toPascalCase(f.name)}Rows(record.${f.name} || []);
      set${toPascalCase(f.name)}Keys((record.${f.name} || []).map((r: any) => r.id));`).join('\n')}
    }).catch((err: any) => {
      message.error(err.message || '加载失败');
    }).finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (isEditing) {
        const dto: Update${n.pascalSingular}Dto = {
${headerDtoFields.join('\n')}
${o2mDtoFields.join('\n')}
        };
        await update${n.pascalSingular}(id!, dto);
        message.success('保存成功');
      } else {
        const dto: Create${n.pascalSingular}Dto = {
${headerDtoFields.join('\n')}
${o2mDtoFields.join('\n')}
        };
        const created = await create${n.pascalSingular}(dto);
        message.success('创建成功');
        history.replace(\`/lc/${n.kebabName}/\${created.id}\`);
      }
    } catch (err: any) {
      if (!err?.errorFields) message.error(err.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };
${dto.approvalFlow?.enabled ? `
  const handleSubmitApproval = async () => {
    try {
      await form.validateFields();
      setSubmitting(true);
      await handleSave();
      await submit${n.pascalSingular}Approval(id!, form.getFieldsValue());
      message.success('已提交审批');
    } catch (err: any) {
      if (!err?.errorFields) message.error(err.message || '提交审批失败');
    } finally {
      setSubmitting(false);
    }
  };` : ''}

  return (
    <Spin spinning={loading}>
      <Card
        title={isEditing ? '编辑${headerShortName}' : '新建${headerShortName}'}
        extra={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => history.push('/lc/${n.kebabName}')}>返回列表</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={submitting} onClick={handleSave}>保存草稿</Button>
            ${dto.approvalFlow?.enabled ? `<Button type="primary" icon={<CheckOutlined />} loading={submitting} onClick={handleSubmitApproval} style={{ background: '#52c41a', borderColor: '#52c41a' }}>提交审批</Button>` : ''}
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <ProForm form={form} submitter={false} layout="horizontal" grid labelCol={{ span: 6 }} colProps={{ span: 12 }}>
${headerFormItems.join('\n\n')}
        </ProForm>
      </Card>

${o2mSections.join('\n\n')}
    </Spin>
  );
}
`;
}

/**
 * Generate an Excel-like editable grid page (grid pageType).
 *
 * Every row is inline-editable. Simple types (varchar/text/number/decimal/
 * boolean/dict/timestamp) and relations (m2o/m2m via dropdown) edit in-cell and
 * auto-save per-cell on a debounce (PATCH /lc/<table>/:id with only the changed
 * field — the generated UpdateDto is already partial, and O2M/M2M updates are
 * guarded so a single-field patch never touches relations). Read-only fields
 * (image/file/code/calculated/point) render as display-only cells. Rows can be
 * appended (local until 保存) and deleted inline.
 */
export function generateFrontendGridPage(dto: AutoCodeDto, _relationDictTypes: Map<string, string | null> = new Map()): string {
  const n = deriveNames(dto.tableName);
  const isNumericF = (f: AutoCodeField) => f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal';

  const AUDIT_COLS = new Set(['id', 'created_at', 'updated_at', 'owner_id', 'created_by', 'updated_by', 'deleted_at', 'createdAt', 'updatedAt', 'ownerId', 'createdBy', 'updatedBy', 'deletedAt']);
  const CELL_EDITABLE = new Set(['varchar', 'text', 'integer', 'bigint', 'decimal', 'boolean', 'dict', 'timestamp']);
  const editableFields = dto.fields.filter(
    (f) => !f.removed && f.editable && !AUDIT_COLS.has(f.name) &&
      (CELL_EDITABLE.has(f.type) || (f.type === 'relation' && (f.relationType === 'many-to-one' || f.relationType === 'many-to-many'))),
  );
  const readOnlyFields = dto.fields.filter(
    (f) => !f.removed && !AUDIT_COLS.has(f.name) && ['code', 'calculated', 'image', 'file', 'point'].includes(f.type),
  );

  const hasDict = editableFields.some((f) => f.type === 'dict');
  const hasImage = readOnlyFields.some((f) => f.type === 'image');

  const editableColumns = editableFields.map((f) => {
    const label = f.description || f.name;
    if (f.type === 'boolean') return `    { title: '${label}', dataIndex: '${f.name}', valueType: 'switch', width: 90, ellipsis: true },`;
    if (isNumericF(f)) return `    { title: '${label}', dataIndex: '${f.name}', valueType: 'digit', width: 130, ellipsis: true, fieldProps: { style: { width: '100%' } } },`;
    if (f.type === 'timestamp') return `    { title: '${label}', dataIndex: '${f.name}', valueType: 'dateTime', width: 180, ellipsis: true, fieldProps: { style: { width: '100%' } } },`;
    if (f.type === 'dict') return `    { title: '${label}', dataIndex: '${f.name}', valueType: 'select', width: 150, ellipsis: true, request: async () => { const list = await getDictDetailsByType('${f.dictType || ''}'); return list.map((d: any) => ({ label: d.label, value: d.value })); }, fieldProps: { showSearch: true, allowClear: true } },`;
    if (f.type === 'relation') {
      const fetchFn = `get${toPascalCase(singularize(f.relationTable!))}Options`;
      const displayField = f.relationDisplayField || 'name';
      return `    { title: '${label}', dataIndex: '${f.name}', valueType: 'select', width: 170, ellipsis: true, request: async () => { const res = await ${fetchFn}(); return res.map((item: any) => ({ label: item.${displayField}, value: item.id })); }, fieldProps: { showSearch: true, allowClear: true } },`;
    }
    return `    { title: '${label}', dataIndex: '${f.name}', valueType: 'text', width: 170, ellipsis: true, fieldProps: { style: { width: '100%' } } },`;
  });

  const readOnlyColumns = readOnlyFields.map((f) => {
    const label = f.description || f.name;
    if (f.type === 'image') return `    { title: '${label}', dataIndex: '${f.name}', editable: false, width: 80, search: false, render: (_: any, r: any) => r.${f.name} ? <Image src={r.${f.name}} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '-' },`;
    return `    { title: '${label}', dataIndex: '${f.name}', editable: false, width: 150, ellipsis: true, search: false },`;
  });

  const editableNames = editableFields.map((f) => `'${f.name}'`).join(', ');
  const relationOptionFns = Array.from(new Set(
    editableFields
      .filter((f) => f.type === 'relation' && f.relationTable)
      .map((f) => `get${toPascalCase(singularize(f.relationTable!))}Options`),
  ));
  const timestampFields = editableFields.filter((f) => f.type === 'timestamp');
  const hasTimestamp = timestampFields.length > 0;
  const timestampNames = timestampFields.map((f) => `'${f.name}'`).join(', ');
  const emptyDefaults = editableFields.map((f) => {
    if (f.type === 'boolean') return `${f.name}: false`;
    if (f.type === 'timestamp') return `${f.name}: null`;
    if (isNumericF(f)) return `${f.name}: null`;
    return `${f.name}: ''`;
  }).join(', ');
  const requiredNames = editableFields.filter((f) => f.required).map((f) => `'${f.name}'`).join(', ');

  const _descText = dto.description || n.pascalName;
  const _parenIdx = _descText.indexOf('（');
  const _parenAsciiIdx = _descText.indexOf('(');
  const _splitIdx = _parenIdx > 0 ? _parenIdx : (_parenAsciiIdx > 0 ? _parenAsciiIdx : -1);
  const headerShortName = _splitIdx > 0 ? _descText.slice(0, _splitIdx).trim() : _descText;

  const antdImports = ['Button', 'message', 'Space'];
  if (hasImage) antdImports.push('Image');
  const agentEnabled = !!dto.agentConfig?.enabled;
  const iconImports = ['PlusOutlined'];
  if (agentEnabled) iconImports.push('RobotOutlined');

  return `import React, { useState, useEffect, useCallback, useRef } from 'react';
${hasTimestamp ? "import dayjs from 'dayjs';\n" : ''}import { ${antdImports.join(', ')} } from 'antd';
import { ${iconImports.join(', ')} } from '@ant-design/icons';
import { ProColumns, EditableProTable } from '@ant-design/pro-components';
import {
  get${n.pascalName}List,
  create${n.pascalSingular},
  update${n.pascalSingular},
  delete${n.pascalSingular},${relationOptionFns.length ? `\n  ${relationOptionFns.join(',\n  ')},` : ''}
} from '${n.serviceImportAlias}';
import { getMyBtnPerms } from '@/services/authority-btn';${hasDict ? `\nimport { getDictDetailsByType } from '@/services/dictionary';` : ''}${agentEnabled ? `\nimport EntityAgentPanel from '@/components/EntityAgentPanel';` : ''}

const EDITABLE_FIELDS = [${editableNames}] as const;${hasTimestamp ? `
const TIMESTAMP_FIELDS = [${timestampNames}] as const;` : ''}

// Bridge dayjs (dateTime cells in edit mode) <-> ISO string (API).
// No-op for non-date values.
const toSerial = (v: any) => (v && typeof v === 'object' && typeof v.toISOString === 'function') ? v.toISOString() : v;

export default function ${n.pascalName}GridPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [editableKeys, setEditableKeys] = useState<React.Key[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  const btnPermsRef = useRef<Set<string>>(new Set());
  const originalRef = useRef<Record<string, any>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});${agentEnabled ? `
  const [agentOpen, setAgentOpen] = useState(false);` : ''}

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      // Backend caps pageSize at 100 (PaginationDto @Max(100)), so page through
      // all rows. MAX_PAGES guards against runaway fetches on very large tables.
      const PAGE_SIZE = 100;
      const MAX_PAGES = 100;
      const all: any[] = [];
      let page = 1;
      let total = 0;
      while (page <= MAX_PAGES) {
        const res = await get${n.pascalName}List({ page, pageSize: PAGE_SIZE });
        const chunk = res.list || [];
        all.push(...chunk);
        total = res.total ?? all.length;
        if (all.length >= total || chunk.length < PAGE_SIZE) break;
        page++;
      }
      originalRef.current = {};
      all.forEach((r: any) => {
        ${hasTimestamp ? `TIMESTAMP_FIELDS.forEach((k: string) => { if (r[k]) r[k] = dayjs(r[k]); });` : ''}
        originalRef.current[r.id] = { ...r };
      });
      setRows(all);
      setEditableKeys(all.map((r: any) => r.id));
      setNewIds(new Set());
      if (all.length < total) message.warning(\`数据较多，仅加载前 \${all.length} 条\`);
    } catch (e: any) {
      message.error(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      const entry = perms['${n.pageComponentPath}'];
      const s = new Set(entry?.systemBtns ?? []);
      btnPermsRef.current = s;
      setBtnPerms(s);
    }).catch(() => {}).finally(() => { loadList(); });
  }, [loadList]);

  useEffect(() => () => { Object.values(saveTimers.current).forEach((t) => clearTimeout(t)); }, []);

  // Per-cell debounced auto-save: diff the changed row against its last-saved
  // snapshot and PATCH only the changed field(s). New (unsaved) rows are skipped.
  const schedulePatch = useCallback((record: any) => {
    const id = record?.id;
    if (!id || newIds.has(id)) return;
    const orig = originalRef.current[id];
    if (!orig) return;
    const patch: Record<string, any> = {};
    (EDITABLE_FIELDS as readonly string[]).forEach((key) => {
      const cur = toSerial(record[key]);
      const old = toSerial(orig[key]);
      if (cur !== old) patch[key] = cur;
    });
    if (Object.keys(patch).length === 0) return;
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(async () => {
      try {
        await update${n.pascalSingular}(id, patch);
        originalRef.current[id] = { ...record };
      } catch (e: any) {
        message.error(e.message || '保存失败');
        loadList();
      }
    }, 600);
  }, [newIds, loadList]);

  // New rows have no server id, so they can't be PATCHed. Auto-create them
  // (debounced) once the required fields are filled — this makes a new row
  // persist as you type, instead of vanishing on refresh. Until the required
  // fields are present we leave it local (no spammy errors).
  const scheduleCreate = useCallback((record: any) => {
    const id = record?.id;
    if (!id) return;
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(async () => {
      const payload: any = {};
      (EDITABLE_FIELDS as readonly string[]).forEach((key) => {
        const v = record[key];
        if (v !== '' && v !== null && v !== undefined) payload[key] = toSerial(v);
      });${requiredNames ? `
      for (const req of [${requiredNames}] as const) {
        if (payload[req] === undefined || payload[req] === '' || payload[req] === null) return; // not ready yet
      }` : ''}
      try {
        const created = await create${n.pascalSingular}(payload);
        setRows((prev) => prev.map((r: any) => (r.id === id ? created : r)));
        setNewIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
        originalRef.current[created.id] = { ...created };
      } catch (e: any) {
        message.error(e.message || '创建失败');
      }
    }, 800);
  }, []);

  const handleAddRow = () => {
    const tempId = 'new_' + Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6);
    const empty = { id: tempId, ${emptyDefaults} };
    setRows((prev) => [...prev, empty]);
    setEditableKeys((prev) => [...prev, tempId]);
    setNewIds((prev) => { const s = new Set(prev); s.add(tempId); return s; });
  };

  const handleSaveNew = async (id: string) => {
    const row = rows.find((r: any) => r.id === id);
    if (!row) return;
    const payload: any = {};
    (EDITABLE_FIELDS as readonly string[]).forEach((key) => {
      const v = row[key];
      if (v !== '' && v !== null && v !== undefined) payload[key] = toSerial(v);
    });${requiredNames ? `
    for (const req of [${requiredNames}] as const) {
      if (payload[req] === undefined || payload[req] === '' || payload[req] === null) { message.warning('请填写必填项'); return; }
    }` : ''}
    try {
      if (saveTimers.current[id]) { clearTimeout(saveTimers.current[id]); delete saveTimers.current[id]; }
      const created = await create${n.pascalSingular}(payload);
      setRows((prev) => prev.map((r: any) => (r.id === id ? created : r)));
      setNewIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      originalRef.current[created.id] = { ...created };
      message.success('已创建');
    } catch (e: any) {
      message.error(e.message || '创建失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (newIds.has(id)) {
      setRows((prev) => prev.filter((r: any) => r.id !== id));
      setEditableKeys((prev) => prev.filter((k) => k !== id));
      setNewIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      return;
    }
    try {
      await delete${n.pascalSingular}(id);
      setRows((prev) => prev.filter((r: any) => r.id !== id));
      setEditableKeys((prev) => prev.filter((k) => k !== id));
      delete originalRef.current[id];
      message.success('已删除');
    } catch (e: any) {
      message.error(e.message || '删除失败');
    }
  };

  const columns: ProColumns<any>[] = [
${readOnlyColumns.length > 0 ? readOnlyColumns.join('\n') + '\n' : ''}${editableColumns.join('\n')}
  ];

  return (
    <>
    <EditableProTable<any>
      headerTitle="${headerShortName}（单元格直编，自动保存）"
      rowKey="id"
      loading={loading}
      value={rows}
      onChange={(data: any) => setRows(data || [])}
      recordCreatorProps={false}
      scroll={{ x: 'max-content' }}
      sticky
      search={false}
      pagination={false}
      editable={{
        type: 'multiple',
        editableKeys,
        onChange: setEditableKeys,
        onValuesChange: (record: any) => {
          if (!record || !record.id) return;
          if (newIds.has(record.id)) scheduleCreate(record); else schedulePatch(record);
        },
        actionRender: (row: any) => {
          const isNew = newIds.has(row.id);
          const nodes: React.ReactNode[] = [];
          if (isNew) {
            if (btnPerms.has('add')) nodes.push(<a key="save" onClick={() => handleSaveNew(row.id)}>保存</a>);
            if (btnPerms.has('add')) nodes.push(<a key="cancel" style={{ color: '#ff4d4f' }} onClick={() => handleDelete(row.id)}>取消</a>);
          } else {
            if (btnPerms.has('delete')) nodes.push(<a key="del" style={{ color: '#ff4d4f' }} onClick={() => handleDelete(row.id)}>删除</a>);
          }
          return nodes;
        },
      }}
      columns={columns}
      toolBarRender={() => [
        btnPerms.has('add') ? <Button key="add" type="primary" icon={<PlusOutlined />} onClick={handleAddRow}>新增行</Button> : false,${agentEnabled ? `
        btnPerms.has('agent') ? <Button key="agent" icon={<RobotOutlined />} onClick={() => setAgentOpen(true)}>AI 助手</Button> : false,` : ''}
      ].filter(Boolean) as React.ReactNode[]}
    />${agentEnabled ? `
    <EntityAgentPanel
      open={agentOpen}
      businessType="${n.tableName}"
      onClose={() => setAgentOpen(false)}
    />` : ''}
    </>
  );
}
`;
}

/**
 * Generate a GIS overview map page for tables that contain point fields.
 * The page fetches all records, plots each as a Leaflet marker, and shows
 * field values in a popup when the marker is clicked.
 */
export function generateFrontendMapPage(dto: AutoCodeDto): string {
  const n = deriveNames(dto.tableName);
  const af = dto.fields.filter((f) => !f.removed);
  const pointField = af.filter((f) => f.type === 'point')[0]!;
  // String-like fields for filters (first 4 non-point, non-timestamp, non-id)
  const filterFields = af.filter(
    (f) => f.type !== 'point' && f.type !== 'timestamp' && f.name !== 'id' &&
           (f.type === 'varchar' || f.type === 'text' || f.type === 'dict'),
  ).slice(0, 4);
  // Popup detail fields (first 6 non-point, non-timestamp, non-id)
  const popupFields = af.filter(
    (f) => f.type !== 'point' && f.type !== 'timestamp' && f.name !== 'id',
  ).slice(0, 6);
  const titleField = popupFields[0];
  const menuName = dto.description || n.pascalName;

  // Generate filter state declarations
  const filterStateLines = filterFields.map(
    (f) => `  const [filter${toPascalCase(f.name)}, setFilter${toPascalCase(f.name)}] = useState('');`,
  ).join('\n');

  // Generate filter bar JSX — dict fields get Select, others get Input
  const filterBarItems = filterFields.map((f) => {
    if (f.type === 'dict') {
      return `        <Select
          placeholder="${f.description || f.name}"
          allowClear
          style={{ width: 140 }}
          options={${toCamelCase(f.name)}Options}
          onChange={(v) => setFilter${toPascalCase(f.name)}(v ?? '')}
        />`;
    }
    return `        <Input
          placeholder="${f.description || f.name}"
          ${filterFields[0] === f ? 'prefix={<SearchOutlined />}' : ''}
          allowClear
          style={{ width: 160 }}
          onChange={(e) => setFilter${toPascalCase(f.name)}(e.target.value)}
        />`;
  }).join('\n');

  // Generate filter predicate lines
  const filterPredicates = filterFields.map(
    (f) => `        if (filter${toPascalCase(f.name)} && !String(row.${f.name} ?? '').toLowerCase().includes(filter${toPascalCase(f.name)}.toLowerCase())) return false;`,
  ).join('\n');

  // Dict options for Select filters
  const dictOptionStates = filterFields
    .filter((f) => f.type === 'dict')
    .map((f) => `  const ${toCamelCase(f.name)}Options = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { if (r.${f.name}) set.add(String(r.${f.name})); });
    return Array.from(set).map((s) => ({ label: s, value: s }));
  }, [rows]);`)
    .join('\n');

  const antdImports = ['Spin', 'Empty', 'Typography', 'Input', 'Select', 'Space', 'Tag'];

  return `import React, { useEffect, useState, useMemo } from 'react';
import { ${antdImports.join(', ')} } from 'antd';
import { EnvironmentOutlined, SearchOutlined } from '@ant-design/icons';
import GeoMapView, { parsePoint } from '@/components/GeoMapView';
import type { GeoMapPoint } from '@/components/GeoMapView';
import { get${n.pascalName}List } from '${n.serviceImportAlias}';
import type { ${n.pascalSingular} } from '${n.serviceImportAlias}';

export default function ${n.pascalName}MapPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<${n.pascalSingular}[]>([]);
${filterStateLines}

  useEffect(() => {
    setLoading(true);
    const PAGE_SIZE = 100;
    const fetchAll = async () => {
      const all: ${n.pascalSingular}[] = [];
      let page = 1;
      while (true) {
        const res = await get${n.pascalName}List({ page, pageSize: PAGE_SIZE });
        all.push(...(res.list ?? []));
        if (all.length >= res.total || (res.list ?? []).length < PAGE_SIZE) break;
        page++;
      }
      return all;
    };
    fetchAll().then(setRows).finally(() => setLoading(false));
  }, []);

${dictOptionStates}
  const filteredPoints = useMemo<GeoMapPoint[]>(() => {
    return rows
      .filter((row) => {
${filterPredicates}
        return true;
      })
      .flatMap((row) => {
        const pos = parsePoint(row.${pointField.name} as string);
        if (!pos) return [];
        return [{
          position: pos,
          ${titleField ? `title: String(row.${titleField.name} ?? ''),` : ''}
          fields: [
${popupFields.map((f) => `            { label: '${f.description || f.name}', value: String(row.${f.name} ?? '') },`).join('\n')}
          ],
        }];
      });
  }, [rows${filterFields.map((f) => `, filter${toPascalCase(f.name)}`).join('')}]);

  const totalWithPos = useMemo(
    () => rows.filter((r) => parsePoint(r.${pointField.name} as string)).length,
    [rows],
  );

  return (
    <div style={{ padding: '0 24px 24px' }}>
      <Typography.Title level={4} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <EnvironmentOutlined />
        ${menuName} — 地图一览
      </Typography.Title>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12,
        padding: '12px 16px', background: '#fafafa',
        border: '1px solid #f0f0f0', borderRadius: 8,
      }}>
${filterBarItems}
        <Space style={{ marginLeft: 'auto', color: '#888', fontSize: 13 }}>
          显示 <Tag color="blue">{filteredPoints.length}</Tag> / {totalWithPos} 个位置
        </Space>
      </div>
      <Spin spinning={loading}>
        {!loading && filteredPoints.length === 0 ? (
          <Empty description="暂无符合条件的位置数据" style={{ padding: 80 }} />
        ) : (
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #f0f0f0' }}>
            <GeoMapView points={filteredPoints} height="calc(100vh - 280px)" />
          </div>
        )}
      </Spin>
    </div>
  );
}
`;
}
