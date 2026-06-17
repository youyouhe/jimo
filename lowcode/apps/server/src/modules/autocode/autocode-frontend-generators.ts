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

    const childFieldLines = f.detailFields.map((df) => {
      if (df.type === 'relation' && df.relationType === 'one-to-many' && df.detailFields && df.detailFields.length > 0) {
        const grandPascalType = toPascalCase(`${singularize(dto.tableName)}_${singularize(f.name)}_${singularize(df.name)}`);
        return `  ${df.name}: ${grandPascalType}[];`;
      }
      const tsType = toTsType(df);
      const nullable = !df.required && df.type !== 'boolean' ? ' | null' : '';
      return `  ${df.name}: ${tsType}${nullable};`;
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
    .filter((f) => f.creatable && f.type !== 'code')
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
    .filter((f) => f.editable && f.type !== 'code')
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
  return `import request from './request';${needsDictImportInService ? `\nimport { getDictDetailsByType } from './dictionary';` : ''}
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
${relationFetchFunctions.join('')}
`;
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

  // ProColumns generation
  const columnLines = listableFields.map((f) => {
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
      render: (_, record) => record.${f.name} ? <img src={record.${f.name}} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 4 }} /> : '-',
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
    if (f.type === 'relation' && (f.relationType === 'many-to-one' || f.relationType === 'many-to-many')) {
      const m2oDictType = relationDictTypes.get(f.name);
      const renderExpr = m2oDictType
        ? `{ const code = record.${f.name}_display || record.${f.name}; return ${toCamelCase(f.name)}TypeMap[code ?? ''] ?? code; }`
        : `record.${f.name}_display || record.${f.name}`;
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

  // Form fields for create/edit
  // 'code' fields are auto-generated — skip in create form, show disabled in edit only
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

    if (f.type === 'relation') {
      // One-to-many: render EditableProTable for detail rows
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

        // Grandchild columns: add extra sub-table columns for each grandchild one-to-many
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

          return `            {
              title: '${gf.description || gf.name}',
              dataIndex: '${gf.name}',
              valueType: 'option',
              width: 200,
              render: (_: any, row: any) => {
                const grandRows: any[] = row.${gf.name} || [];
                const [grandKeys, setGrandKeys] = React.useState<React.Key[]>(() => grandRows.map((r: any) => r.id));
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
              },
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

      // Many-to-one or many-to-many: render single-select ProFormSelect
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
    if (f.type === 'text') {
      return `          <${component}
            name="${f.name}"
            label="${f.description || f.name}"
            placeholder="${f.description || f.name}"
            ${requiredRule}
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

  // Request params destructure (exclude many-to-many from query params in table)
  const tableSearchableFields = searchableFields.filter((f) => !(f.type === 'relation' && (f.relationType === 'one-to-many')));
  const requestParamKeys = tableSearchableFields.map((f) => f.name).join(', ');
  const requestDestructure = tableSearchableFields.length > 0
    ? `const { current: page, pageSize${requestParamKeys ? `, ${requestParamKeys}` : ''} } = params;`
    : 'const { current: page, pageSize } = params;';

  // Handle submit: build DTO
  // 'code' fields are auto-generated server-side — exclude from create/update DTOs
  const createDtoFields = creatableFields.filter((f) => f.type !== 'code').map((f) => {
    if (f.type === 'relation' && f.relationType === 'one-to-many') {
      const tsFields = (f.detailFields || []).filter((df: any) => df.type === 'timestamp' && df.name !== 'id');
      const tsOverrides = tsFields.map((df: any) => `            ${df.name}: d.${df.name} && typeof d.${df.name} === 'object' ? d.${df.name}.toISOString() : d.${df.name},`).join('\n');
      return `          ${f.name}: (values.${f.name} || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
${tsOverrides ? tsOverrides + '\n' : ''}          })),`;
    }
    if (f.type === 'boolean') {
      return `          ${f.name}: values.${f.name} ?? false,`;
    }
    if (f.type === 'integer' || f.type === 'bigint') {
      return `          ${f.name}: values.${f.name} ?? 0,`;
    }
    if (f.type === 'decimal') {
      return `          ${f.name}: String(values.${f.name} ?? '0'),`;
    }
    if (f.type === 'relation') {
      return `          ${f.name}: values.${f.name} || undefined,`;
    }
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
  });

  // 'code' fields are never submitted in update DTO (they are immutable after creation)
  const updateDtoFields = editableFields.filter((f) => f.type !== 'code').map((f) => {
    if (f.type === 'relation' && f.relationType === 'one-to-many') {
      const tsFields = (f.detailFields || []).filter((df: any) => df.type === 'timestamp' && df.name !== 'id');
      const tsOverrides = tsFields.map((df: any) => `            ${df.name}: d.${df.name} && typeof d.${df.name} === 'object' ? d.${df.name}.toISOString() : d.${df.name},`).join('\n');
      return `          ${f.name}: (values.${f.name} || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
${tsOverrides ? tsOverrides + '\n' : ''}          })),`;
    }
    if (f.type === 'boolean') {
      return `          ${f.name}: values.${f.name} ?? false,`;
    }
    if (f.type === 'integer' || f.type === 'bigint') {
      return `          ${f.name}: values.${f.name} ?? 0,`;
    }
    if (f.type === 'decimal') {
      return `          ${f.name}: String(values.${f.name} ?? '0'),`;
    }
    if (f.type === 'relation') {
      return `          ${f.name}: values.${f.name} || undefined,`;
    }
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
  });

  const apiFunctions = [
    `get${n.pascalName}List`,
    `create${n.pascalSingular}`,
    `update${n.pascalSingular}`,
    `delete${n.pascalSingular}`,
    `batchDelete${n.pascalName}`,
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

  const oneToManyFields = dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many' && f.detailFields && f.detailFields.length > 0);
  const antdImports = ['Button', 'message', 'Popconfirm', 'Space', 'Form', 'Table', 'Input'];
  if (hasUploadFields) antdImports.push('Upload');
  const needsTabsForExpand = oneToManyFields.length > 1 || oneToManyFields.some(f => f.detailFields!.filter(df => df.type === 'relation' && df.relationType === 'one-to-many' && df.detailFields && df.detailFields.length > 0).length > 1);
  if (needsTabsForExpand) antdImports.push('Tabs');
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

  return `import React, { useRef, useState, useEffect, useCallback } from 'react';
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
} from '@/services/${n.kebabSingular}';
import { getMyBtnPerms } from '@/services/authority-btn';${hasUploadFields ? `\nimport { uploadFile } from '@/services/file';` : ''}${hasDictFields ? `\nimport { getDictDetailsByType } from '@/services/dictionary';` : ''}

export default function ${n.pascalName}Page() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<${n.pascalSingular} | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
${hasOneToMany ? `${dto.fields.filter(f => f.type === 'relation' && f.relationType === 'one-to-many').map(f => `  const [${toCamelCase(f.name)}EditableKeys, set${toPascalCase(f.name)}EditableKeys] = useState<React.Key[]>([]);`).join('\n')}\n  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);\n  const currentDataRef = useRef<${n.pascalSingular}[]>([]);\n` : ''}${dictFields.length > 0 ? dictFields.map(f => `  const [${toCamelCase(f.name)}Options, set${toPascalCase(f.name)}Options] = useState<Record<string, { text: string }>>({});`).join('\n') + '\n' : ''}${manyToOneDictFields.length > 0 ? manyToOneDictFields.map(({ field: f }) => `  const [${toCamelCase(f.name)}TypeMap, set${toPascalCase(f.name)}TypeMap] = useState<Record<string, string>>({});`).join('\n') + '\n' : ''}${tableSearchableFields.flatMap(f => (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal') ? [`  const [search${toPascalCase(f.name)}Min, setSearch${toPascalCase(f.name)}Min] = useState('');`, `  const [search${toPascalCase(f.name)}Max, setSearch${toPascalCase(f.name)}Max] = useState('');`] : [`  const [search${toPascalCase(f.name)}, setSearch${toPascalCase(f.name)}] = useState('');`]).join('\n')}${tableSearchableFields.length > 0 ? `
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Fetch directly from sys_authority_btns on every page visit.
  // This is the single source of truth — same data the backend Guard checks.
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      setBtnPerms(new Set(perms['./${n.kebabName}/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<${n.pascalSingular}>[] = [
${columnLines.join('\n')}
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: '创建人',
      dataIndex: 'createdBy',
      valueType: 'text',
      width: 120,
      search: false,
    },
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
                  actionRef.current?.reload();
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
      actionRef.current?.reload();
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
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<${n.pascalSingular}>
        headerTitle="${dto.description || n.pascalName}"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
${oneToManyFields.length > 0 ? `        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
          rowExpandable: (record) => ${oneToManyFields.map(f => `(record.${f.name}?.length ?? 0) > 0`).join(' || ')},
          expandedRowRender: (record) => (
            ${oneToManyFields.length === 1 ? (() => {
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
            })() : `<Tabs
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
            />`}
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
        ].filter(Boolean)}
      />

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
${(() => {
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
  // Multiple 1:N fields → wrap in Tabs
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
})()}
      </ModalForm>
    </>
  );
}
`;
}
