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

// ========== Shared form/column builders used by page generators ==========

export function buildDtoFieldTemplate(f: AutoCodeField): string {
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
export function buildColumns(
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
export function buildFormFields(
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
export function ${compName}({ row, form }: { row: any; form: any }) {
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
export function buildModalFormBody(formFields: string[], creatableFields: AutoCodeField[]): string {
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
export function buildExpandedRowRender(
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

// ========== Page-type generators (extracted to individual files) ==========

export { generateFrontendService } from './generators/service-generator';
export { generateFrontendPage } from './generators/list-page-generator';
export { generateFrontendDocumentListPage, generateFrontendDocumentPage } from './generators/document-page-generator';
export { generateFrontendGridPage } from './generators/grid-page-generator';
export { generateFrontendMapPage } from './generators/map-page-generator';
export { generateFrontendCalendarPage } from './generators/calendar-page-generator';
