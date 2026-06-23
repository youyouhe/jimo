import { Injectable, Logger, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { streamText, tool, jsonSchema, type CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { eq, isNull, sql } from 'drizzle-orm';
import { AI_GENERATOR_SYSTEM_PROMPT } from './ai-generator.prompt';
import { isReservedTableName } from './reserved-names';
import {
  PROPOSE_ENTITY_TOOL,
  CREATE_DICT_TOOL,
  CREATE_PACKAGE_TOOL,
  LIST_TABLES_TOOL,
  LIST_DICTS_TOOL,
  LIST_PACKAGES_TOOL,
  GENERATE_MOCK_TOOL,
  LIST_HISTORY_TOOL,
  DELETE_ENTITY_TOOL,
  LIST_MENUS_BY_PACKAGE_TOOL,
  ASSIGN_TO_PACKAGE_TOOL,
  DESCRIBE_TABLE_TOOL,
} from './ai-generator.tool';
import type { AiChatRequestDto } from './ai-generator.dto';
import { DATABASE_CONNECTION, type DrizzleDb } from '../../db/connection';
import { sysDictionaries } from '../../db/schema/dictionaries';
import { sysDictionaryDetails } from '../../db/schema/dictionary-details';
import { sysAutoCodePackages } from '../../db/schema/auto-code-packages';
import { sysAutoCodeHistories } from '../../db/schema/auto-code-histories';
import { AutocodeService } from './autocode.service';

/**
 * AI 实体生成器服务。
 *
 * 多轮 tool calling 流程:
 *  1. AI 可用 list_tables / list_dicts / list_packages 查询当前状态（只读）
 *  2. 若需字典不存在，调 create_dict 创建（幂等：先查后建）
 *  3. 调 propose_entity 提交方案 → 前端展示方案卡
 *  4. 用户确认 → 前端调现有 autocode/generate
 *
 * 使用 Vercel AI SDK streamText() 驱动多步 tool calling，maxSteps: 15。
 */
@Injectable()
export class AiGeneratorService {
  private readonly logger = new Logger(AiGeneratorService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly autocodeService: AutocodeService,
  ) {}

  async streamChatToRes(
    dto: AiChatRequestDto,
    aiKey: string | undefined,
    baseUrl: string | undefined,
    model: string | undefined,
    res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const write = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const lastMsg = dto.messages?.at(-1)?.content ?? '';
    this.logger.log(
      `[AiGenerator] ▶ ai-chat received | model=${model ?? '(none)'} baseUrl=${baseUrl ?? '(none)'} keyLen=${aiKey?.length ?? 0} lastMsg="${lastMsg.slice(0, 80)}"`,
    );

    if (!aiKey || !baseUrl || !model) {
      this.logger.warn(
        `[AiGenerator] ✗ 配置缺失 aiKey=${!!aiKey} baseUrl=${!!baseUrl} model=${!!model}`,
      );
      write({ kind: 'error', message: '缺少 AI 配置(apiKey / baseUrl / model)' });
      write({ kind: 'done' });
      res.end();
      return;
    }

    let aborted = false;
    res.on('close', () => {
      aborted = true;
      this.logger.log('[AiGenerator] client disconnected (SSE close)');
    });

    try {
      // 查询当前系统状态，注入为对话首条消息对（高注意力位置）
      const [dictRows, pkgRows, entityRows] = await Promise.all([
        this.db
          .select({ type: sysDictionaries.type, name: sysDictionaries.name })
          .from(sysDictionaries)
          .catch(() => [] as { type: string; name: string }[]),
        this.db
          .select({ id: sysAutoCodePackages.id, name: sysAutoCodePackages.name })
          .from(sysAutoCodePackages)
          .catch(() => [] as { id: string; name: string }[]),
        this.db
          .selectDistinct({ tableName: sysAutoCodeHistories.tableName })
          .from(sysAutoCodeHistories)
          .catch(() => [] as { tableName: string }[]),
      ]);

      const dictList = dictRows.map((d) => `\`${d.type}\`（${d.name}）`).join('、') || '（暂无）';
      const pkgList = pkgRows.map((p) => `\`${p.id}\`（${p.name}）`).join('、') || '（暂无）';
      const tableList = entityRows.map((e) => `\`${e.tableName}\``).join('、') || '（暂无）';

      // 将状态注入为对话开头的 user/assistant 消息对，模型注意力最高
      const stateMessage: CoreMessage = {
        role: 'user',
        content: `## 系统当前状态（请在本次对话中严格遵守）

### 已生成的实体表（⛔ 绝对不要再 propose_entity 同名表；relation 可直接引用）
${tableList}

### 现有字典（✅ 优先匹配这些 dictType；确认不存在再调 create_dict）
${dictList}

### 现有 Package（✅ 优先匹配这些 id。用户没明确要求建 package 时一律不要 create_package，表可留空 packageId 落入未分类）
${pkgList}`,
      };
      const stateAck: CoreMessage = {
        role: 'assistant',
        content: '已收到系统状态，我会在本次对话中：① 不重复提议已存在的表；② 优先复用现有字典和 Package；③ 需要时用 list_tables/list_dicts/list_packages 实时查询最新状态；④ 用户没明确要求时不创建 Package，绝不为单张表硬建同名 Package，表可留空 packageId。',
      };

      const userMessages = dto.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const messages: CoreMessage[] = [stateMessage, stateAck, ...userMessages];

      const openaiProvider = createOpenAI({ baseURL: baseUrl.replace(/\/+$/, ''), apiKey: aiKey });
      const modelInstance = openaiProvider(model) as any;

      this.logger.log(`[AiGenerator] AI baseURL: ${baseUrl.replace(/\/+$/, '')}`);

      const result = streamText({
        model: modelInstance,
        system: AI_GENERATOR_SYSTEM_PROMPT,
        messages,
        maxSteps: 15,
        tools: {
          propose_entity: tool({
            description: PROPOSE_ENTITY_TOOL.function.description,
            parameters: jsonSchema(PROPOSE_ENTITY_TOOL.function.parameters as any),
            execute: async (args: any) => {
              this.logger.log(`[AiGenerator] ✓ propose_entity: ${args.tableName}`);
              // Guard: 系统保留名前置拦截(防止生成覆盖系统页面/服务)
              if (isReservedTableName(args.tableName)) {
                return { ok: false, error: `表名 '${args.tableName}' 是系统保留名,会覆盖平台自带的系统页面/服务。请改用其他名称。` };
              }
              // Guard: 同时查生成历史与物理表,拦截同名遗留表
              const lcTable = `lc_${args.tableName}`;
              const [existing, physCheck] = await Promise.all([
                this.db
                  .selectDistinct({ tableName: sysAutoCodeHistories.tableName })
                  .from(sysAutoCodeHistories)
                  .where(eq(sysAutoCodeHistories.tableName, args.tableName))
                  .limit(1)
                  .catch(() => []),
                this.db
                  .execute(sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${lcTable} LIMIT 1`)
                  .catch(() => ({ rows: [] as any[] })),
              ]);
              if (existing.length > 0) {
                return { ok: false, error: `表 '${args.tableName}' 已存在(生成历史中有记录)。若要修改请用 update 流程；若要重建请先 delete_entity 删除后再 propose。` };
              }
              if (physCheck.rows?.length) {
                return {
                  ok: false,
                  error: `物理表 '${lcTable}' 已存在于数据库,但不在生成历史中(历史遗留/孤儿表)。直接 propose 会导致 drizzle-kit push 与现有结构冲突并静默失败。请先处理: ① 若要复用现有数据/结构,改用 update 流程; ② 若确认无用,请提示用户手动执行 DROP TABLE ${lcTable} 后再 propose。`,
                };
              }
              const entityDto = { ...args };
              if (entityDto.packageId) {
                try {
                  const pkg = await this.autocodeService.findOnePackage(entityDto.packageId);
                  if (pkg) entityDto.packageName = pkg.name;
                } catch { /* silent fallback */ }
              }
              write({ kind: 'tool_result', dto: entityDto });
              return { ok: true };
            },
          }),

          create_dict: tool({
            description: CREATE_DICT_TOOL.function.description,
            parameters: jsonSchema(CREATE_DICT_TOOL.function.parameters as any),
            execute: async (args: any) => {
              write({ kind: 'progress', content: `正在创建字典 "${args.name}"…` });
              return await this.executeCreateDict(args);
            },
          }),

          create_package: tool({
            description: CREATE_PACKAGE_TOOL.function.description,
            parameters: jsonSchema(CREATE_PACKAGE_TOOL.function.parameters as any),
            execute: async (args: any) => {
              write({ kind: 'progress', content: `正在创建 Package "${args.name}"…` });
              return await this.executeCreatePackage(args);
            },
          }),

          list_tables: tool({
            description: LIST_TABLES_TOOL.function.description,
            parameters: jsonSchema(LIST_TABLES_TOOL.function.parameters as any),
            execute: async () => {
              try {
                // 同时查生成历史与物理表,暴露"物理存在但历史无记录"的孤儿表(遗留/被清过历史)
                const [histRows, physRows] = await Promise.all([
                  this.db
                    .selectDistinct({ tableName: sysAutoCodeHistories.tableName })
                    .from(sysAutoCodeHistories)
                    .catch(() => [] as { tableName: string }[]),
                  this.db
                    .execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name ~ '^lc_' ORDER BY table_name`)
                    .catch(() => ({ rows: [] as any[] })),
                ]);
                const histSet = new Set(histRows.map((r) => r.tableName));
                const physNames = (physRows.rows ?? []).map((r: any) =>
                  String(r.table_name).replace(/^lc_/, ''),
                );
                const orphans = physNames.filter((n) => !histSet.has(n)); // 物理存在但历史无记录
                const all = Array.from(new Set([...histSet, ...physNames])).sort();
                return { tables: all, orphans };
              } catch (e: any) {
                return { tables: [], error: e?.message };
              }
            },
          }),

          list_dicts: tool({
            description: LIST_DICTS_TOOL.function.description,
            parameters: jsonSchema(LIST_DICTS_TOOL.function.parameters as any),
            execute: async () => {
              try {
                const rows = await this.db
                  .select({ type: sysDictionaries.type, name: sysDictionaries.name })
                  .from(sysDictionaries)
                  .limit(200);
                return { dicts: rows.map((r) => ({ type: r.type, name: r.name })) };
              } catch (e: any) {
                return { dicts: [], error: e?.message };
              }
            },
          }),

          list_packages: tool({
            description: LIST_PACKAGES_TOOL.function.description,
            parameters: jsonSchema(LIST_PACKAGES_TOOL.function.parameters as any),
            execute: async () => {
              try {
                const rows = await this.db
                  .select({ id: sysAutoCodePackages.id, name: sysAutoCodePackages.name })
                  .from(sysAutoCodePackages)
                  .where(isNull(sysAutoCodePackages.deletedAt))
                  .limit(200);
                return { packages: rows.map((r) => ({ id: r.id, name: r.name })) };
              } catch (e: any) {
                return { packages: [], error: e?.message };
              }
            },
          }),

          generate_mock: tool({
            description: GENERATE_MOCK_TOOL.function.description,
            parameters: jsonSchema(GENERATE_MOCK_TOOL.function.parameters as any),
            execute: async (args: unknown) => {
              const { tableName, count } = args as { tableName: string; count?: number };
              // Guard: verify the physical table exists in the database before inserting
              try {
                const tableCheck = await this.db.execute(
                  sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${'lc_' + tableName} LIMIT 1`
                );
                if (!tableCheck.rows?.length) {
                  return { ok: false, tableName, error: `数据库中不存在表 'lc_${tableName}'。该表可能尚未通过 drizzle-kit push 创建，请先确认生成流程是否成功完成。` };
                }
              } catch (e: any) {
                return { ok: false, tableName, error: `检查表存在性失败: ${e?.message}` };
              }
              try {
                const safeCount = Math.min(Math.max(count ?? 10, 1), 100);
                const result = await this.autocodeService.generateMockForTable(tableName, safeCount);
                write({ kind: 'progress', content: `已为 '${tableName}' 插入 ${result.inserted} 条 mock 数据` });
                return { ok: true, tableName, inserted: result.inserted };
              } catch (e: any) {
                return { ok: false, tableName, error: e?.message };
              }
            },
          }),

          list_history: tool({
            description: LIST_HISTORY_TOOL.function.description,
            parameters: jsonSchema(LIST_HISTORY_TOOL.function.parameters as any),
            execute: async (args: unknown) => {
              const { tableName, limit } = (args as any) ?? {};
              const safeLimit = Math.min(Math.max(limit ?? 20, 1), 50);
              const result = await this.autocodeService.findAllHistory({ page: 1, pageSize: safeLimit, tableName });
              return result.list.map((h) => ({
                id: h.id,
                tableName: h.tableName,
                changeLog: h.changeLog,
                operation: h.operation,
                createdAt: h.createdAt,
              }));
            },
          }),

          list_menus_by_package: tool({
            description: LIST_MENUS_BY_PACKAGE_TOOL.function.description,
            parameters: jsonSchema(LIST_MENUS_BY_PACKAGE_TOOL.function.parameters as any),
            execute: async () => {
              return await this.autocodeService.listMenusByPackage();
            },
          }),

          assign_to_package: tool({
            description: ASSIGN_TO_PACKAGE_TOOL.function.description,
            parameters: jsonSchema(ASSIGN_TO_PACKAGE_TOOL.function.parameters as any),
            execute: async (args: unknown) => {
              const { tableName, packageId } = (args as any) ?? {};
              // Guard: verify table exists in history and package exists before moving
              const [tableRows, pkgRows] = await Promise.all([
                this.db
                  .selectDistinct({ tableName: sysAutoCodeHistories.tableName })
                  .from(sysAutoCodeHistories)
                  .where(eq(sysAutoCodeHistories.tableName, tableName))
                  .limit(1)
                  .catch(() => []),
                this.db
                  .select({ id: sysAutoCodePackages.id, name: sysAutoCodePackages.name })
                  .from(sysAutoCodePackages)
                  .where(eq(sysAutoCodePackages.id, packageId))
                  .limit(1)
                  .catch(() => []),
              ]);
              if (tableRows.length === 0) {
                return { ok: false, error: `表 '${tableName}' 不存在，请先用 list_tables 确认表名。` };
              }
              if (pkgRows.length === 0) {
                return { ok: false, error: `Package id='${packageId}' 不存在，请先用 list_menus_by_package 或 list_packages 获取正确的 packageId。` };
              }
              try {
                const result = await this.autocodeService.assignToPackage(tableName, packageId);
                write({ kind: 'progress', content: `已将 '${tableName}' 归入 package ${packageId}（菜单移动: ${result.movedMenu}）` });
                return { ok: true, tableName, packageId, movedMenu: result.movedMenu };
              } catch (e: any) {
                return { ok: false, tableName, error: e?.message };
              }
            },
          }),

          describe_table: tool({
            description: DESCRIBE_TABLE_TOOL.function.description,
            parameters: jsonSchema(DESCRIBE_TABLE_TOOL.function.parameters as any),
            execute: async (args: unknown) => {
              const { tableName } = (args as any) ?? {};
              try {
                const rows = await this.db
                  .select({ fields: sysAutoCodeHistories.fields, version: sysAutoCodeHistories.version })
                  .from(sysAutoCodeHistories)
                  .where(eq(sysAutoCodeHistories.tableName, tableName))
                  .orderBy(sysAutoCodeHistories.version)
                  .limit(1);
                if (rows.length === 0 || !rows[0].fields) {
                  return { ok: false, tableName, error: '未找到该表的生成记录，请先确认表名（不含 lc_ 前缀）' };
                }
                const fields = rows[0].fields as any[];
                const summary = fields
                  .filter((f) => !f.removed)
                  .map((f) => ({
                    name: f.name,
                    type: f.type,
                    description: f.description,
                    required: f.required,
                    ...(f.relationType ? { relationType: f.relationType, relationTable: f.relationTable } : {}),
                    ...(f.dictType ? { dictType: f.dictType } : {}),
                  }));
                write({ kind: 'progress', content: `已获取 '${tableName}' 字段结构（${summary.length} 个字段）` });
                return { ok: true, tableName, fields: summary };
              } catch (e: any) {
                return { ok: false, tableName, error: e?.message };
              }
            },
          }),

          delete_entity: tool({
            description: DELETE_ENTITY_TOOL.function.description,
            parameters: jsonSchema(DELETE_ENTITY_TOOL.function.parameters as any),
            execute: async (args: unknown) => {
              const { id, cascade } = (args as any) ?? {};
              // Guard: verify the history record exists before attempting delete
              try {
                const historyRows = await this.db
                  .select({ tableName: sysAutoCodeHistories.tableName })
                  .from(sysAutoCodeHistories)
                  .where(eq(sysAutoCodeHistories.id, id))
                  .limit(1);
                if (historyRows.length === 0) {
                  return { ok: false, id, error: `未找到 id='${id}' 的历史记录。请先用 list_history 查询正确的 id。` };
                }
                const tableName = historyRows[0].tableName;
                if (isReservedTableName(tableName)) {
                  return { ok: false, id, error: `系统保留名 '${tableName}',拒绝删除(保护系统资产)。` };
                }
                write({ kind: 'progress', content: `确认删除目标：表 '${tableName}'（id: ${id}）` });
              } catch (e: any) {
                return { ok: false, id, error: `查询历史记录失败: ${e?.message}` };
              }
              try {
                write({ kind: 'progress', content: `正在删除历史记录 ${id}…` });
                const jobId = await this.autocodeService.startDeleteHistory(id, cascade === true);
                // Poll until done (max 60s)
                const deadline = Date.now() + 60_000;
                while (Date.now() < deadline) {
                  await new Promise(r => setTimeout(r, 1500));
                  const status = await this.autocodeService.getJobStatus(jobId);
                  if (!status) break;
                  if (status.status === 'completed') {
                    write({ kind: 'progress', content: `删除完成` });
                    return { ok: true, id };
                  }
                  if (status.status === 'failed') {
                    return { ok: false, id, error: status.steps?.find(s => s.status === 'failed')?.label ?? '删除失败' };
                  }
                }
                return { ok: false, id, error: '删除超时' };
              } catch (e: any) {
                return { ok: false, id, error: e?.message };
              }
            },
          }),
        },
        onChunk: ({ chunk }: any) => {
          if (aborted) return;
          if (chunk.type === 'text-delta') {
            write({ kind: 'token', content: chunk.textDelta });
          }
        },
      });

      for await (const _ of result.textStream) {
        if (aborted) break;
      }

      if (!aborted) {
        write({ kind: 'done' });
        res.end();
      }
    } catch (e: any) {
      this.logger.error(`[AiGenerator] ✗ 流式调用失败: ${e?.message}\n${e?.stack?.slice(0, 800)}`);
      if (!aborted) {
        write({ kind: 'error', message: e?.message || 'AI 调用失败' });
        write({ kind: 'done' });
        res.end();
      }
    }
  }

  /** create_dict：先查后建，幂等 */
  private async executeCreateDict(args: {
    type: string;
    name: string;
    items: Array<{ label: string; value: string }>;
  }): Promise<{ ok: boolean; dictType: string; message: string }> {
    const { type, name, items = [] } = args;
    try {
      // 幂等：若 type 已存在则直接返回
      const existing = await this.db
        .select({ id: sysDictionaries.id })
        .from(sysDictionaries)
        .where(eq(sysDictionaries.type, type))
        .limit(1);
      if (existing.length > 0) {
        this.logger.log(`[AiGenerator] create_dict skip (already exists) type="${type}"`);
        return { ok: true, dictType: type, message: `字典 "${type}" 已存在，直接复用` };
      }

      const dictRows = await this.db
        .insert(sysDictionaries)
        .values({ type, name, status: 1, sort: 0 })
        .returning({ id: sysDictionaries.id });
      const dictId = dictRows[0]?.id;
      if (dictId && items.length > 0) {
        await this.db.insert(sysDictionaryDetails).values(
          items.map((item, i) => ({
            dictId,
            label: item.label,
            value: item.value,
            status: 1,
            sort: i + 1,
          })),
        );
      }
      this.logger.log(
        `[AiGenerator] create_dict ✓ type="${type}" name="${name}" items=${items.length}`,
      );
      return { ok: true, dictType: type, message: `字典 "${name}"(${type}) 创建成功(${items.length} 项)` };
    } catch (e: any) {
      this.logger.error(`[AiGenerator] create_dict ✗ type="${type}": ${e?.message}`);
      return { ok: false, dictType: type, message: `创建字典失败: ${e?.message}` };
    }
  }

  /** create_package：先查后建，幂等（按名称匹配） */
  private async executeCreatePackage(args: {
    name: string;
    description?: string;
  }): Promise<{ ok: boolean; packageId: string; name: string; message: string }> {
    const { name, description } = args;
    try {
      // 幂等：按名称查现有 package
      const existing = await this.db
        .select({ id: sysAutoCodePackages.id })
        .from(sysAutoCodePackages)
        .where(eq(sysAutoCodePackages.name, name))
        .limit(1);
      if (existing.length > 0) {
        const packageId = existing[0].id;
        this.logger.log(`[AiGenerator] create_package skip (already exists) name="${name}" id=${packageId}`);
        return { ok: true, packageId, name, message: `Package "${name}" 已存在，直接复用 id=${packageId}` };
      }

      const pkg = await this.autocodeService.createPackage({
        name,
        description: description || '',
        templates: {},
      });
      const packageId = pkg.id;
      this.logger.log(`[AiGenerator] create_package ✓ name="${name}" id=${packageId}`);
      return { ok: true, packageId, name, message: `Package "${name}" 创建成功` };
    } catch (e: any) {
      this.logger.error(`[AiGenerator] create_package ✗ name="${name}": ${e?.message}`);
      return { ok: false, packageId: '', name, message: `创建 Package 失败: ${e?.message}` };
    }
  }

  /** 测试 BYOK 配置连通性（非流式极简请求） */
  async testConnection(
    aiKey: string | undefined,
    baseUrl: string | undefined,
    model: string | undefined,
  ): Promise<{ ok: boolean; message: string }> {
    if (!aiKey || !baseUrl || !model) {
      return { ok: false, message: '配置不完整(apiKey / baseUrl / model)' };
    }
    try {
      const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5,
          stream: false,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        return { ok: false, message: `AI 服务返回 ${resp.status}: ${text.slice(0, 200)}` };
      }
      const data: any = await resp.json().catch(() => ({}));
      const reply: string = data?.choices?.[0]?.message?.content || '';
      return {
        ok: true,
        message: `连接成功${reply ? ` · 模型回复: ${reply.slice(0, 40)}` : ''}`,
      };
    } catch (e: any) {
      return { ok: false, message: e?.message || '连接失败(检查 baseUrl 是否可达)' };
    }
  }
}
