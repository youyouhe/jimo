import type { AutoCodeDto, AutoCodeField } from '../dto/autocode.dto';
import { toPascalCase, toCamelCase, singularize, deriveNames, getProFormComponent } from '../autocode-field-utils';
import { buildDtoFieldTemplate } from '../autocode-frontend-generators';

export function generateFrontendDocumentListPage(dto: AutoCodeDto, relationDictTypes: Map<string, string | null> = new Map()): string {
  const n = deriveNames(dto.tableName, dto._packageSlug ?? '');
  const listableFields = dto.fields.filter((f) => f.listable && !(f.type === 'relation' && f.relationType === 'one-to-many'));
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
  const n = deriveNames(dto.tableName, dto._packageSlug ?? '');
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
