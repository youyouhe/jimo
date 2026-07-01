import type { AutoCodeDto, AutoCodeField } from '../dto/autocode.dto';
import { toPascalCase, toCamelCase, deriveNames } from '../autocode-field-utils';

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
