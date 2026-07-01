import type { AutoCodeDto, AutoCodeField } from '../dto/autocode.dto';
import { deriveNames, singularize, toPascalCase } from '../autocode-field-utils';
import { buildFormFields, buildModalFormBody } from '../autocode-frontend-generators';

/**
 * Generate a calendar view page using antd <Calendar> (month view).
 * Records are shown as event chips on dates from a start-date timestamp field
 * (and optional end-date field). Click a date cell to create prefilled; click
 * a chip to edit. Reuses buildFormFields + buildModalFormBody for the modal form.
 */
export function generateFrontendCalendarPage(dto: AutoCodeDto, _relationDictTypes: Map<string, string | null> = new Map()): string {
  const n = deriveNames(dto.tableName, dto._packageSlug ?? '');
  const AUDIT_COLS = new Set(['id', 'created_at', 'updated_at', 'owner_id', 'created_by', 'updated_by', 'deleted_at', 'createdAt', 'updatedAt', 'ownerId', 'createdBy', 'updatedBy', 'deletedAt']);

  // Calendar field resolution
  const startField = dto.fields.find((f) => !f.removed && f.calendarStart && f.type === 'timestamp')
    || dto.fields.find((f) => !f.removed && f.type === 'timestamp')
    || dto.fields[0];
  const endField = dto.fields.find((f) => !f.removed && f.calendarEnd && f.type === 'timestamp');

  // Calendar title: explicit user-selected fields (calendarTitle=true) OR fallback heuristic
  const titleFields = dto.fields.filter((f) => !f.removed && f.calendarTitle && (f.type === 'varchar' || f.type === 'text'));
  const hasExplicitTitle = titleFields.length > 0;
  const fallbackTitle = dto.fields.find(
    (f) => !f.removed && f.listable && (f.type === 'varchar' || f.type === 'text') && /^(name|title|label|subject|no)$/i.test(f.name),
  )
    || dto.fields.find((f) => !f.removed && f.listable && (f.type === 'varchar' || f.type === 'text'))
    || startField;

  const startName = startField.name;
  const endName = endField ? endField.name : '';
  // Title expression used in the events mapping below
  const titleExpr = hasExplicitTitle
    ? `[${titleFields.map((f) => `r.${f.name}`).join(', ')}].filter(Boolean).join(' - ') || 'Untitled'`
    : `r.${fallbackTitle.name} || ''`;

  // Modal form (reuse list page helpers)
  const creatableFields = dto.fields.filter((f) => !f.removed && f.creatable && !AUDIT_COLS.has(f.name));
  const { formFields } = buildFormFields(creatableFields, dto);
  const modalBody = buildModalFormBody(formFields, creatableFields);

  const hasDict = creatableFields.some((f) => f.type === 'dict');
  const agentEnabled = !!dto.agentConfig?.enabled;

  const antdImports = ['Calendar', 'Button', 'Form', 'message'];
  if (agentEnabled) antdImports.push('Space');
  const iconImports = ['PlusOutlined'];
  if (agentEnabled) iconImports.push('RobotOutlined');

  const lines: string[] = [];
  const P = (s: string) => lines.push(s);

  // --- imports --------------------------------------------------------------
  P(`import React, { useState, useEffect, useCallback } from 'react';`);
  P(`import { ${antdImports.join(', ')} } from 'antd';`);
  P(`import { ${iconImports.join(', ')} } from '@ant-design/icons';`);
  P(`import { ModalForm, ProFormText, ProFormTextArea, ProFormSelect, ProFormDigit, ProFormDateTimePicker, ProFormSwitch } from '@ant-design/pro-components';`);
  P(`import dayjs from 'dayjs';`);
  P(`import { get${n.pascalName}List, create${n.pascalSingular}, update${n.pascalSingular}, delete${n.pascalSingular} } from '${n.serviceImportAlias}';`);
  P(`import { getMyBtnPerms } from '@/services/authority-btn';`);
  if (hasDict) P(`import { getDictDetailsByType } from '@/services/dictionary';`);
  if (agentEnabled) P(`import EntityAgentPanel from '@/components/EntityAgentPanel';`);

  // --- component ------------------------------------------------------------
  P(``);
  P(`export default function ${n.pascalName}CalendarPage() {`);
  P(`  const [records, setRecords] = useState<any[]>([]);`);
  P(`  const [loading, setLoading] = useState(false);`);
  P(`  const [month, setMonth] = useState(dayjs());`);
  P(`  const [btnPerms, setBtnPerms] = useState(new Set<string>());`);
  P(`  const [modalOpen, setModalOpen] = useState(false);`);
  P(`  const [editing, setEditing] = useState<any>(null);`);
  P(`  const [presetStart, setPresetStart] = useState<any>(null);`);
  P(`  const [form] = Form.useForm();`);
  if (agentEnabled) P(`  const [agentOpen, setAgentOpen] = useState(false);`);

  // events derived from records
  P(``);
  P(`  const events = records.map((r: any) => ({`);
  P(`    key: r.id,`);
  P(`    title: ${titleExpr},`);
  P(`    start: dayjs(r.${startName}),`);
  if (endField) {
    P(`    end: r.${endName} ? dayjs(r.${endName}) : null,`);
  } else {
    P(`    end: null,`);
  }
  P(`    record: r,`);
  P(`  }));`);

  // loadList
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
  P(`      if (all.length < total) message.warning('Showing first ' + String(all.length) + ' records');`);
  P(`    } catch (e: any) {`);
  P(`      message.error(e.message || 'Load failed');`);
  P(`    } finally {`);
  P(`      setLoading(false);`);
  P(`    }`);
  P(`  }, []);`);

  // btn perms
  P(``);
  P(`  useEffect(() => {`);
  P(`    getMyBtnPerms().then((perms) => {`);
  P(`      const entry = perms['${n.pageComponentPath}'];`);
  P(`      setBtnPerms(new Set(entry?.systemBtns ?? []));`);
  P(`    }).catch(() => {}).finally(() => { loadList(); });`);
  P(`  }, [loadList]);`);

  // cellRender
  P(``);
  P(`  const cellRender = useCallback((date: any, info: { type: string; originNode?: React.ReactNode }) => {`);
  P(`    if (info.type !== 'date') return info.originNode ?? null;`);
  P(`    const d = date.startOf('day');`);
  P(`    const isWeekend = d.day() === 0 || d.day() === 6;`);
  P(`    const dayEvts = events.filter((e: any) => {`);
  P(`      if (!e.start) return false;`);
  P(`      const s = e.start.startOf('day');`);
  P(`      const ee = (e.end ?? e.start).startOf('day');`);
  P(`      return s.unix() <= d.unix() && d.unix() <= ee.unix();`);
  P(`    });`);
  P(`    const body = dayEvts.length === 0 ? null : dayEvts.map((e: any) => (`);
  P(`      <div key={e.key} onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); setEditing(e.record); setModalOpen(true); form.setFieldsValue(e.record); }}`);
  P(`        style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: '#1890ff' }}>`);
  P(`        - {e.title}`);
  P(`      </div>`);
  P(`    ));`);
  P(`    if (!isWeekend) return body;`);
  P(`    return <div style={{ background: '#f5f5f5', minHeight: '100%' }}>{body}</div>;`);
  P(`  }, [events, form]);`);

  // handleSubmit
  P(``);
  P(`  const handleSubmit = async (values: any) => {`);
  if (endField) P(`    if (!values.${endName}) delete values.${endName};`);
  P(`    if (editing) {`);
  P(`      await update${n.pascalSingular}(editing.id, values);`);
  P(`      message.success('Saved');`);
  P(`    } else {`);
  P(`      const payload = { ...values };`);
  P(`      if (presetStart) payload.${startName} = presetStart.toISOString();`);
  if (endField) P(`      if (!payload.${endName}) delete payload.${endName};`);
  P(`      await create${n.pascalSingular}(payload);`);
  P(`      message.success('Created');`);
  P(`    }`);
  P(`    setModalOpen(false);`);
  P(`    setEditing(null);`);
  P(`    setPresetStart(null);`);
  P(`    form.resetFields();`);
  P(`    loadList();`);
  P(`  };`);

  // --- JSX ------------------------------------------------------------------
  P(``);
  P(`  return (`);
  P(`    <>`);
  P(`    <Calendar`);
  P(`      cellRender={cellRender}`);
  P(`      onSelect={(date: any) => { setPresetStart(date); setEditing(null); form.resetFields(); setModalOpen(true); }}`);
  P(`      value={month}`);
  P(`      onChange={(d: any) => setMonth(d)}`);
  P(`      style={{ padding: 16 }}`);
  P(`    />`);
  P(`    <ModalForm`);
  P(`      title={editing ? 'Edit' : 'New'}`);
  P(`      open={modalOpen}`);
  P(`      form={form}`);
  P(`      onOpenChange={(open: boolean) => {`);
  P(`        setModalOpen(open);`);
  P(`        if (!open) setTimeout(() => { setEditing(null); setPresetStart(null); }, 300);`);
  P(`      }}`);
  P(`      onFinish={handleSubmit}`);
  P(`      modalProps={{ destroyOnClose: true }}`);
  P(`    >`);
  P(modalBody);
  if (endField) {
    P(`      <ProFormDateTimePicker name="${endName}" label="${endField.description || endName}" />`);
  }
  P(`    </ModalForm>`);
  P(`    <div style={{ position: 'sticky', bottom: 0, background: '#fff', padding: '8px 16px', display: 'flex', gap: 8, borderTop: '1px solid #f0f0f0' }}>`);
  P(`      <Button onClick={() => setMonth(dayjs())}>Today</Button>`);
  P(`      {btnPerms.has('add') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setPresetStart(dayjs()); setEditing(null); form.resetFields(); setModalOpen(true); }}>New</Button>}`);
  if (agentEnabled) {
    P(`      {btnPerms.has('agent') && <Button icon={<RobotOutlined />} onClick={() => setAgentOpen(true)}>AI</Button>}`);
  }
  P(`    </div>`);
  if (agentEnabled) {
    P(`    <EntityAgentPanel open={agentOpen} businessType="${n.tableName}" onClose={() => setAgentOpen(false)} />`);
  }
  P(`    </>`);
  P(`  );`);
  P(`}`);

  return lines.join('\n');
}
