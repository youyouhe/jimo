import type { AutoCodeDto, AutoCodeField } from '../dto/autocode.dto';
import { deriveNames, toCamelCase, toPascalCase } from '../autocode-field-utils';
import { buildFormFields, buildModalFormBody } from '../autocode-frontend-generators';

/**
 * Generate a kanban board page. Columns are the runtime options of the field
 * marked kanbanGroup (a dict field) — loaded via getDictDetailsByType so new
 * dict options show up as columns without regenerating. Cards render the
 * kanbanTitle field(s) plus every other listable field. Dragging a card to a
 * different column PATCHes only the group field (@dnd-kit/core, no extra
 * "move" endpoint). Each column has its own "+ 新建" button that presets and
 * locks the group value; the group field is intentionally excluded from the
 * edit modal — changing group membership is drag-only, editing everything
 * else is modal-only.
 */
export function generateFrontendKanbanPage(dto: AutoCodeDto, _relationDictTypes: Map<string, string | null> = new Map()): string {
  const n = deriveNames(dto.tableName, dto._packageSlug ?? '');
  const AUDIT_COLS = new Set(['id', 'created_at', 'updated_at', 'owner_id', 'created_by', 'updated_by', 'deleted_at', 'createdAt', 'updatedAt', 'ownerId', 'createdBy', 'updatedBy', 'deletedAt']);

  // The group field is guaranteed to exist by assertKanbanGroupField (service layer)
  // and by the frontend form's own submit-time check — fall back defensively so a
  // stale/hand-crafted DTO still emits something rather than throwing at codegen time.
  const groupField = dto.fields.find((f) => !f.removed && f.kanbanGroup && f.type === 'dict')
    || dto.fields.find((f) => !f.removed && f.type === 'dict')
    || dto.fields[0];
  const groupName = groupField.name;
  const dictType = groupField.dictType || '';

  // Title: explicit user-selected fields (kanbanTitle=true, join with ' / ') OR fallback heuristic.
  const titleFields = dto.fields.filter((f) => !f.removed && f.kanbanTitle && (f.type === 'varchar' || f.type === 'text'));
  const hasExplicitTitle = titleFields.length > 0;
  const fallbackTitle = dto.fields.find(
    (f) => !f.removed && f.listable && (f.type === 'varchar' || f.type === 'text') && /^(name|title|label|subject|no)$/i.test(f.name),
  )
    || dto.fields.find((f) => !f.removed && f.listable && (f.type === 'varchar' || f.type === 'text'))
    || groupField;
  const titleExpr = hasExplicitTitle
    ? `[${titleFields.map((f) => `r.${f.name}`).join(', ')}].filter(Boolean).join(' / ') || 'Untitled'`
    : `r.${fallbackTitle.name} || ''`;
  const titleFieldNames = new Set([...titleFields.map((f) => f.name), groupName]);

  // Card body: every other listable field, rendered with a light per-type formatter.
  const cardFields = dto.fields.filter(
    (f) => !f.removed && f.listable && !titleFieldNames.has(f.name) &&
      !(f.type === 'relation' && f.relationType === 'one-to-many'),
  );
  const cardDictFields = cardFields.filter((f) => f.type === 'dict');
  const hasCardDict = cardDictFields.length > 0;

  const renderCardValue = (f: AutoCodeField): string => {
    switch (f.type) {
      case 'boolean':
        return `r.${f.name} ? '是' : '否'`;
      case 'timestamp':
        return `r.${f.name} ? dayjs(r.${f.name}).format('YYYY-MM-DD HH:mm') : '-'`;
      case 'dict':
        return `${toCamelCase(f.name)}Options[r.${f.name}] ?? r.${f.name} ?? '-'`;
      case 'relation':
        return `r.${f.name}_display || r.${f.name} || '-'`;
      case 'image':
        return `r.${f.name} ? <img src={r.${f.name}} style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }} /> : '-'`;
      case 'file':
        return `r.${f.name} ? <a href={r.${f.name}} target="_blank" rel="noreferrer">附件</a> : '-'`;
      case 'point':
        return `r.${f.name} ? '📍 已定位' : '-'`;
      default:
        return `r.${f.name} ?? '-'`;
    }
  };

  const cardRows = cardFields.map((f) => `        <div key="${f.name}" style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'rgba(0,0,0,0.45)' }}>${f.description || f.name}：</span>{${renderCardValue(f)}}
        </div>`).join('\n');

  // Modal form: creatable fields minus the group field (group is drag-only).
  const creatableFields = dto.fields.filter((f) => !f.removed && f.creatable && !AUDIT_COLS.has(f.name) && f.name !== groupName);
  const { formFields } = buildFormFields(creatableFields, dto);
  const modalBody = buildModalFormBody(formFields, creatableFields);

  const agentEnabled = !!dto.agentConfig?.enabled;

  const antdImports = ['Button', 'Form', 'message', 'Empty', 'Spin'];
  if (agentEnabled) antdImports.push('Space');
  const iconImports = ['PlusOutlined'];
  if (agentEnabled) iconImports.push('RobotOutlined');

  const lines: string[] = [];
  const P = (s: string) => lines.push(s);

  // --- imports --------------------------------------------------------------
  P(`import React, { useState, useEffect, useCallback, useMemo } from 'react';`);
  P(`import { ${antdImports.join(', ')} } from 'antd';`);
  P(`import { ${iconImports.join(', ')} } from '@ant-design/icons';`);
  P(`import { ModalForm, ProFormText, ProFormTextArea, ProFormSelect, ProFormDigit, ProFormDateTimePicker, ProFormSwitch } from '@ant-design/pro-components';`);
  P(`import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';`);
  P(`import dayjs from 'dayjs';`);
  P(`import { get${n.pascalName}List, create${n.pascalSingular}, update${n.pascalSingular} } from '${n.serviceImportAlias}';`);
  P(`import { getMyBtnPerms } from '@/services/authority-btn';`);
  P(`import { getDictDetailsByType } from '@/services/dictionary';`);
  if (agentEnabled) P(`import EntityAgentPanel from '@/components/EntityAgentPanel';`);

  // --- Card / Column sub-components ------------------------------------------
  P(``);
  P(`const OTHER_COLUMN = '__kanban_other__';`);
  P(``);
  P(`function KanbanCard({ record, onClick }: { record: any; onClick: () => void }) {`);
  P(`  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: record.id });`);
  P(`  const style: React.CSSProperties = {`);
  P(`    transform: transform ? \`translate3d(\${transform.x}px, \${transform.y}px, 0)\` : undefined,`);
  P(`    opacity: isDragging ? 0.5 : 1,`);
  P(`    zIndex: isDragging ? 10 : undefined,`);
  P(`    background: '#fff',`);
  P(`    borderRadius: 6,`);
  P(`    border: '1px solid #f0f0f0',`);
  P(`    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',`);
  P(`    padding: 10,`);
  P(`    marginBottom: 8,`);
  P(`    cursor: 'pointer',`);
  P(`  };`);
  P(`  return (`);
  P(`    <div ref={setNodeRef} style={style} {...listeners} {...attributes} onClick={onClick}>`);
  P(`      <div style={{ fontWeight: 500, marginBottom: ${cardFields.length > 0 ? 6 : 0} }}>{record.__title}</div>`);
  if (cardRows) P(cardRows);
  P(`    </div>`);
  P(`  );`);
  P(`}`);
  P(``);
  P(`function KanbanColumn({ id, title, records, onCardClick, onAddClick }: { id: string; title: string; records: any[]; onCardClick: (r: any) => void; onAddClick: () => void }) {`);
  P(`  const { setNodeRef, isOver } = useDroppable({ id });`);
  P(`  return (`);
  P(`    <div ref={setNodeRef} style={{`);
  P(`      width: 280, flex: '0 0 280px', background: isOver ? '#e6f4ff' : '#fafafa', borderRadius: 8,`);
  P(`      padding: 10, marginRight: 12, display: 'flex', flexDirection: 'column', maxHeight: '100%',`);
  P(`    }}>`);
  P(`      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 2px' }}>`);
  P(`        <span style={{ fontWeight: 600 }}>{title} <span style={{ color: 'rgba(0,0,0,0.45)', fontWeight: 400 }}>({records.length})</span></span>`);
  P(`      </div>`);
  P(`      <div style={{ flex: 1, overflowY: 'auto', minHeight: 40 }}>`);
  P(`        {records.length === 0 ? <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.25)', fontSize: 12, padding: '12px 0' }}>暂无</div> : null}`);
  P(`        {records.map((r: any) => <KanbanCard key={r.id} record={r} onClick={() => onCardClick(r)} />)}`);
  P(`      </div>`);
  P(`      <Button type="dashed" block size="small" icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={onAddClick}>新建</Button>`);
  P(`    </div>`);
  P(`  );`);
  P(`}`);

  // --- main component ---------------------------------------------------------
  P(``);
  P(`export default function ${n.pascalName}KanbanPage() {`);
  P(`  const [records, setRecords] = useState<any[]>([]);`);
  P(`  const [groupOptions, setGroupOptions] = useState<{ label: string; value: string }[]>([]);`);
  P(`  const [loading, setLoading] = useState(false);`);
  P(`  const [btnPerms, setBtnPerms] = useState(new Set<string>());`);
  P(`  const [modalOpen, setModalOpen] = useState(false);`);
  P(`  const [editing, setEditing] = useState<any>(null);`);
  P(`  const [presetGroup, setPresetGroup] = useState<string | null>(null);`);
  P(`  const [form] = Form.useForm();`);
  if (hasCardDict) {
    cardDictFields.forEach((f) => {
      P(`  const [${toCamelCase(f.name)}Options, set${toPascalCase(f.name)}Options] = useState<Record<string, string>>({});`);
    });
  }
  if (agentEnabled) P(`  const [agentOpen, setAgentOpen] = useState(false);`);
  const sensorsLine = `  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));`;
  P(sensorsLine);

  P(``);
  P(`  const titledRecords = useMemo(() => records.map((r: any) => ({ ...r, __title: ${titleExpr} })), [records]);`);

  P(``);
  P(`  const loadList = useCallback(async () => {`);
  P(`    setLoading(true);`);
  P(`    try {`);
  P(`      const PAGE_SIZE = 100;`);
  P(`      const MAX = 500;`);
  P(`      const all: any[] = [];`);
  P(`      let page = 1;`);
  P(`      let total = 0;`);
  P(`      while (all.length < MAX) {`);
  P(`        const res = await get${n.pascalName}List({ page, pageSize: PAGE_SIZE });`);
  P(`        const chunk = res.list || [];`);
  P(`        all.push(...chunk);`);
  P(`        total = res.total ?? all.length;`);
  P(`        if (all.length >= total || chunk.length < PAGE_SIZE) break;`);
  P(`        page++;`);
  P(`      }`);
  P(`      setRecords(all);`);
  P(`      if (all.length < total) message.warning('数据较多，仅加载前 ' + String(all.length) + ' 条（看板不分页，数据量很大时建议改用列表页）');`);
  P(`    } catch (e: any) {`);
  P(`      message.error(e.message || '加载失败');`);
  P(`    } finally {`);
  P(`      setLoading(false);`);
  P(`    }`);
  P(`  }, []);`);

  P(``);
  P(`  useEffect(() => {`);
  P(`    getMyBtnPerms().then((perms) => {`);
  P(`      const entry = perms['${n.pageComponentPath}'];`);
  P(`      setBtnPerms(new Set(entry?.systemBtns ?? []));`);
  P(`    }).catch(() => {}).finally(() => { loadList(); });`);
  P(`    getDictDetailsByType('${dictType}').then(setGroupOptions).catch(() => message.error('看板分组字典加载失败'));`);
  if (hasCardDict) {
    cardDictFields.forEach((f) => {
      P(`    getDictDetailsByType('${f.dictType || ''}').then((list: any[]) => {`);
      P(`      const map: Record<string, string> = {};`);
      P(`      list.forEach((item: any) => { map[item.value] = item.label; });`);
      P(`      set${toPascalCase(f.name)}Options(map);`);
      P(`    }).catch(() => {});`);
    });
  }
  P(`  }, [loadList]);`);

  P(``);
  P(`  const grouped = useMemo(() => {`);
  P(`    const map = new Map<string, any[]>();`);
  P(`    groupOptions.forEach((opt) => map.set(opt.value, []));`);
  P(`    map.set(OTHER_COLUMN, []);`);
  P(`    titledRecords.forEach((r: any) => {`);
  P(`      const key = map.has(r.${groupName}) ? r.${groupName} : OTHER_COLUMN;`);
  P(`      map.get(key)!.push(r);`);
  P(`    });`);
  P(`    return map;`);
  P(`  }, [titledRecords, groupOptions]);`);

  P(``);
  P(`  const handleDragEnd = useCallback(async (event: DragEndEvent) => {`);
  P(`    const { active, over } = event;`);
  P(`    if (!over) return;`);
  P(`    const targetValue = String(over.id);`);
  P(`    if (targetValue === OTHER_COLUMN) return; // "未分类" is a read-only bucket, not a settable value`);
  P(`    const record = records.find((r: any) => r.id === active.id);`);
  P(`    if (!record || record.${groupName} === targetValue) return;`);
  P(`    setRecords((prev) => prev.map((r: any) => (r.id === record.id ? { ...r, ${groupName}: targetValue } : r)));`);
  P(`    try {`);
  P(`      await update${n.pascalSingular}(record.id, { ${groupName}: targetValue } as any);`);
  P(`    } catch (e: any) {`);
  P(`      message.error(e.message || '移动失败');`);
  P(`      setRecords((prev) => prev.map((r: any) => (r.id === record.id ? { ...r, ${groupName}: record.${groupName} } : r)));`);
  P(`    }`);
  P(`  }, [records]);`);

  P(``);
  P(`  const handleSubmit = async (values: any) => {`);
  P(`    if (editing) {`);
  P(`      await update${n.pascalSingular}(editing.id, values);`);
  P(`      message.success('已保存');`);
  P(`    } else {`);
  P(`      const payload = { ...values, ${groupName}: presetGroup };`);
  P(`      await create${n.pascalSingular}(payload);`);
  P(`      message.success('已创建');`);
  P(`    }`);
  P(`    setModalOpen(false);`);
  P(`    setEditing(null);`);
  P(`    setPresetGroup(null);`);
  P(`    form.resetFields();`);
  P(`    loadList();`);
  P(`  };`);

  // --- JSX ------------------------------------------------------------------
  P(``);
  P(`  return (`);
  P(`    <>`);
  P(`    <Spin spinning={loading}>`);
  P(`    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>`);
  P(`      <div style={{ display: 'flex', overflowX: 'auto', padding: 16, minHeight: 400, height: 'calc(100vh - 220px)' }}>`);
  P(`        {groupOptions.length === 0 && !loading ? <Empty description="看板分组字典为空" style={{ margin: 'auto' }} /> : null}`);
  P(`        {groupOptions.map((opt) => (`);
  P(`          <KanbanColumn`);
  P(`            key={opt.value}`);
  P(`            id={opt.value}`);
  P(`            title={opt.label}`);
  P(`            records={grouped.get(opt.value) || []}`);
  P(`            onCardClick={(r) => { setEditing(r); form.setFieldsValue(r); setModalOpen(true); }}`);
  P(`            onAddClick={() => { setEditing(null); setPresetGroup(opt.value); form.resetFields(); setModalOpen(true); }}`);
  P(`          />`);
  P(`        ))}`);
  P(`        {(grouped.get(OTHER_COLUMN) || []).length > 0 ? (`);
  P(`          <KanbanColumn`);
  P(`            id={OTHER_COLUMN}`);
  P(`            title="未分类"`);
  P(`            records={grouped.get(OTHER_COLUMN) || []}`);
  P(`            onCardClick={(r) => { setEditing(r); form.setFieldsValue(r); setModalOpen(true); }}`);
  P(`            onAddClick={() => {}}`);
  P(`          />`);
  P(`        ) : null}`);
  P(`      </div>`);
  P(`    </DndContext>`);
  P(`    </Spin>`);
  P(`    <ModalForm`);
  P(`      title={editing ? '编辑' : '新建'}`);
  P(`      open={modalOpen}`);
  P(`      form={form}`);
  P(`      onOpenChange={(open: boolean) => {`);
  P(`        setModalOpen(open);`);
  P(`        if (!open) setTimeout(() => { setEditing(null); setPresetGroup(null); }, 300);`);
  P(`      }}`);
  P(`      onFinish={handleSubmit}`);
  P(`      modalProps={{ destroyOnClose: true }}`);
  P(`    >`);
  P(modalBody);
  P(`    </ModalForm>`);
  if (agentEnabled) {
    P(`    <div style={{ position: 'sticky', bottom: 0, background: '#fff', padding: '8px 16px', display: 'flex', gap: 8, borderTop: '1px solid #f0f0f0' }}>`);
    P(`      {btnPerms.has('agent') && <Button icon={<RobotOutlined />} onClick={() => setAgentOpen(true)}>AI 助手</Button>}`);
    P(`    </div>`);
    P(`    <EntityAgentPanel open={agentOpen} businessType="${n.tableName}" onClose={() => setAgentOpen(false)} />`);
  }
  P(`    </>`);
  P(`  );`);
  P(`}`);

  return lines.join('\n');
}
