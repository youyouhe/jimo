import type { AutoCodeDto, AutoCodeField } from '../dto/autocode.dto';
import { toPascalCase, toCamelCase, singularize, getProFormComponent, getValueType, deriveNames } from '../autocode-field-utils';
import { buildColumns, buildFormFields, buildModalFormBody, buildDtoFieldTemplate, buildExpandedRowRender } from '../autocode-frontend-generators';

export function generateFrontendPage(dto: AutoCodeDto, relationDictTypes: Map<string, string | null> = new Map()): string {
  const n = deriveNames(dto.tableName, dto._packageSlug ?? '');
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
