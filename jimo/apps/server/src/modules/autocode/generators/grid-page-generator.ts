import type { AutoCodeDto, AutoCodeField } from '../dto/autocode.dto';
import { toPascalCase, toCamelCase, singularize, getProFormComponent, getValueType, deriveNames } from '../autocode-field-utils';

export function generateFrontendGridPage(dto: AutoCodeDto, _relationDictTypes: Map<string, string | null> = new Map()): string {
  const n = deriveNames(dto.tableName, dto._packageSlug ?? '');
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
    const fixed = f.fixed ? `fixed: 'left', ` : '';
    if (f.type === 'boolean') return `    { title: '${label}', dataIndex: '${f.name}', ${fixed}valueType: 'switch', width: 90, ellipsis: true },`;
    if (isNumericF(f)) return `    { title: '${label}', dataIndex: '${f.name}', ${fixed}valueType: 'digit', width: 130, ellipsis: true, fieldProps: { style: { width: '100%' } } },`;
    if (f.type === 'timestamp') return `    { title: '${label}', dataIndex: '${f.name}', ${fixed}valueType: 'dateTime', width: 180, ellipsis: true, fieldProps: { style: { width: '100%' } } },`;
    if (f.type === 'dict') return `    { title: '${label}', dataIndex: '${f.name}', ${fixed}valueType: 'select', width: 150, ellipsis: true, request: async () => { const list = await getDictDetailsByType('${f.dictType || ''}'); return list.map((d: any) => ({ label: d.label, value: d.value })); }, fieldProps: { showSearch: true, allowClear: true } },`;
    if (f.type === 'relation') {
      const fetchFn = `get${toPascalCase(singularize(f.relationTable!))}Options`;
      const displayField = f.relationDisplayField || 'name';
      return `    { title: '${label}', dataIndex: '${f.name}', ${fixed}valueType: 'select', width: 170, ellipsis: true, request: async () => { const res = await ${fetchFn}(); return res.map((item: any) => ({ label: item.${displayField}, value: item.id })); }, fieldProps: { showSearch: true, allowClear: true } },`;
    }
    return `    { title: '${label}', dataIndex: '${f.name}', ${fixed}valueType: 'text', width: 170, ellipsis: true, fieldProps: { style: { width: '100%' } } },`;
  });

  const readOnlyColumns = readOnlyFields.map((f) => {
    const label = f.description || f.name;
    const fixed = f.fixed ? `fixed: 'left', ` : '';
    if (f.type === 'image') return `    { title: '${label}', dataIndex: '${f.name}', ${fixed}editable: false, width: 80, search: false, render: (_: any, r: any) => r.${f.name} ? <Image src={r.${f.name}} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '-' },`;
    return `    { title: '${label}', dataIndex: '${f.name}', ${fixed}editable: false, width: 150, ellipsis: true, search: false },`;
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
      // Backend caps pageSize at 100 (PaginationDto @Max(100)). Grid loads at
      // most MAX_ROWS rows — beyond that performance degrades with all rows in
      // edit mode. Users should filter first on large tables.
      const PAGE_SIZE = 100;
      const MAX_ROWS = 500;
      const all: any[] = [];
      let page = 1;
      let total = 0;
      while (all.length < MAX_ROWS) {
        const res = await get${n.pascalName}List({ page, pageSize: PAGE_SIZE });
        const chunk = res.list || [];
        all.push(...chunk);
        total = res.total ?? all.length;
        if (all.length >= total || chunk.length < PAGE_SIZE) break;
        page++;
      }
      originalRef.current = {};
      all.forEach((r: any) => {
        r.__key = r.id; // stable client key; server id changes when a new row is persisted
        ${hasTimestamp ? `TIMESTAMP_FIELDS.forEach((k: string) => { if (r[k]) r[k] = dayjs(r[k]); });` : ''}
        originalRef.current[r.id] = { ...r };
      });
      setRows(all);
      setEditableKeys(all.map((r: any) => r.__key));
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
    if (!id || newIds.has(record.__key)) return;
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
    const key = record?.__key;
    if (!key) return;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      const payload: any = {};
      (EDITABLE_FIELDS as readonly string[]).forEach((f) => {
        const v = record[f];
        if (v !== '' && v !== null && v !== undefined) payload[f] = toSerial(v);
      });${requiredNames ? `
      for (const req of [${requiredNames}] as const) {
        if (payload[req] === undefined || payload[req] === '' || payload[req] === null) return; // not ready yet
      }` : ''}
      try {
        const created = await create${n.pascalSingular}(payload);
        // Keep __key stable across the create so EditableProTable never loses
        // edit state (mutating rowKey would desync its internal tracking).
        setRows((prev) => prev.map((r: any) => (r.__key === key ? { ...created, __key: key } : r)));
        setNewIds((prev) => { const s = new Set(prev); s.delete(key); return s; });
        originalRef.current[created.id] = { ...created };
      } catch (e: any) {
        message.error(e.message || '创建失败');
      }
    }, 800);
  }, []);

  const handleAddRow = () => {
    const tempKey = 'new_' + Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6);
    const empty = { __key: tempKey, id: tempKey, ${emptyDefaults} };
    setRows((prev) => [...prev, empty]);
    setEditableKeys((prev) => [...prev, tempKey]);
    setNewIds((prev) => { const s = new Set(prev); s.add(tempKey); return s; });
  };

  const handleSaveNew = async (row: any) => {
    const key = row?.__key;
    if (!key) return;
    const payload: any = {};
    (EDITABLE_FIELDS as readonly string[]).forEach((f) => {
      const v = row[f];
      if (v !== '' && v !== null && v !== undefined) payload[f] = toSerial(v);
    });${requiredNames ? `
    for (const req of [${requiredNames}] as const) {
      if (payload[req] === undefined || payload[req] === '' || payload[req] === null) { message.warning('请填写必填项'); return; }
    }` : ''}
    try {
      if (saveTimers.current[key]) { clearTimeout(saveTimers.current[key]); delete saveTimers.current[key]; }
      const created = await create${n.pascalSingular}(payload);
      setRows((prev) => prev.map((r: any) => (r.__key === key ? { ...created, __key: key } : r)));
      setNewIds((prev) => { const s = new Set(prev); s.delete(key); return s; });
      originalRef.current[created.id] = { ...created };
      message.success('已创建');
    } catch (e: any) {
      message.error(e.message || '创建失败');
    }
  };

  const handleDelete = async (row: any) => {
    const key = row?.__key;
    if (!key) return;
    if (newIds.has(key)) {
      setRows((prev) => prev.filter((r: any) => r.__key !== key));
      setEditableKeys((prev) => prev.filter((k) => k !== key));
      setNewIds((prev) => { const s = new Set(prev); s.delete(key); return s; });
      return;
    }
    try {
      await delete${n.pascalSingular}(row.id);
      setRows((prev) => prev.filter((r: any) => r.__key !== key));
      setEditableKeys((prev) => prev.filter((k) => k !== key));
      delete originalRef.current[row.id];
      message.success('已删除');
    } catch (e: any) {
      message.error(e.message || '删除失败');
    }
  };

  const columns: ProColumns<any>[] = [
${readOnlyColumns.length > 0 ? readOnlyColumns.join('\n') + '\n' : ''}${editableColumns.join('\n')}
    { title: '操作', valueType: 'option', width: 120, fixed: 'right', align: 'center', render: (_: any, row: any) => {
      const isNew = !!(row.__key && newIds.has(row.__key));
      return [
        isNew && btnPerms.has('add') ? <a key="save" onClick={() => handleSaveNew(row)}>保存</a> : null,
        (isNew ? btnPerms.has('add') : btnPerms.has('delete')) ? <a key="del" style={{ color: '#ff4d4f' }} onClick={() => handleDelete(row)}>{isNew ? '取消' : '删除'}</a> : null,
      ].filter(Boolean) as React.ReactNode[];
    } },
  ];

  return (
    <>
    <EditableProTable<any>
      headerTitle="${headerShortName}（单元格直编，自动保存）"
      rowKey="__key"
      loading={loading}
      value={rows}
      onChange={(data: any) => setRows(data || [])}
      recordCreatorProps={false}
      scroll={{ x: 'max-content' }}
      sticky
      search={false}
      pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'], showTotal: (t: number) => \`共 \${t} 条\` }}
      editable={{
        type: 'multiple',
        editableKeys,
        onChange: () => {},
        onValuesChange: (record: any) => {
          if (!record || !record.__key) return;
          if (newIds.has(record.__key)) scheduleCreate(record); else schedulePatch(record);
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
