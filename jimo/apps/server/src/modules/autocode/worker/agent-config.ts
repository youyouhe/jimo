/**
 * Pure-function port of AutocodeService.buildAgentConfigMetadata.
 * Called by tools/generate-worker.ts to pre-set templates.__agent before saveHistory.
 *
 * The service version is a private method; the worker (no NestJS DI) can't call it,
 * so we port the same logic here. Keep in sync with autocode.service.ts.
 *
 * See worker/history.ts header: saveHistory does NOT merge __agent itself — the
 * caller is expected to pre-set it on the templates object passed in. Without this,
 * history rows end up with has_agent=true but templates.__agent=null, which makes
 * the entity-scoped agent chat fail with "未找到 Agent 配置".
 */
import type { AutoCodeDto } from '../dto/autocode.dto';
import { activeFields, deriveMasterSingular, singularize } from '../autocode-field-utils';

export function buildAgentConfigMetadata(dto: AutoCodeDto): Record<string, any> {
  const activeFieldsArray = activeFields(dto.fields);
  const subTableFkMap: Record<string, Record<string, string>> = {};
  for (const f of activeFieldsArray) {
    if (f.type !== 'relation' || f.relationType !== 'one-to-many') continue;
    if (!f.detailFields || f.detailFields.length === 0) continue;
    const singularMain = deriveMasterSingular(dto.tableName);
    const singularField = singularize(f.name);
    const subLcTable = (f.relationExistingTable && f.relationTable)
      ? `lc_${f.relationTable}`
      : `lc_${singularMain}_${singularField}`;
    const fkMap: Record<string, string> = {};
    const isExistingSubTable = !!(f.relationExistingTable && f.relationTable);
    const parentFkCol = isExistingSubTable ? (f.relationFkColumn || `${singularMain}_id`) : `${singularMain}_id`;
    fkMap[parentFkCol] = dto.tableName;
    for (const df of f.detailFields) {
      if (df.type === 'relation' && (df.relationType === 'many-to-one' || df.relationType === 'many-to-many') && df.relationTable) {
        fkMap[df.name] = `lc_${df.relationTable}`;
      }
    }
    subTableFkMap[subLcTable] = fkMap;
  }

  return {
    tableName: dto.tableName,
    visibilityStrategy: dto.visibilityStrategy ?? 'private',
    enabledTools: dto.agentConfig?.tools ?? ['query', 'create', 'update', 'delete', 'search', 'mock'],
    systemPrompt: dto.agentConfig?.systemPrompt ?? '',
    // 'code' is server-auto-generated; 'calculated' is virtual (computed on
    // read). Neither is ever user/agent-settable, so exclude them from the
    // agent's create/update/search field sets — otherwise the agent would
    // advertise computed fields as inputs and try to assign them (the values
    // get silently stripped by the DTO, but the behavior model would be wrong).
    creatableFields: activeFieldsArray.filter((f) => f.creatable && !(f.type === 'relation' && f.relationType === 'one-to-many') && f.type !== 'code' && f.type !== 'calculated'),
    editableFields: activeFieldsArray.filter((f) => f.editable && !(f.type === 'relation' && f.relationType === 'one-to-many') && f.type !== 'code' && f.type !== 'calculated'),
    searchableFields: activeFieldsArray.filter((f) => f.searchable && f.type !== 'calculated'),
    subTableFkMap,
  };
}
