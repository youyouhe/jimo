import { Injectable, Logger, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { streamText, tool, jsonSchema, type CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { eq, isNull, sql, desc } from 'drizzle-orm';
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
  LIST_BTN_PERMS_TOOL,
  ADD_CUSTOM_BTN_TOOL,
  REMOVE_CUSTOM_BTN_TOOL,
} from './ai-generator.tool';
import { AuthorityBtnService } from '../authority-btn/authority-btn.service';
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
    private readonly authorityBtnService: AuthorityBtnService,
  ) {}

  async streamChatToRes(
    dto: AiChatRequestDto,
    aiKey: string | undefined,
    baseUrl: string | undefined,
    model: string | undefined,
    res: Response,
    userId?: string,
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
    let doneSent = false;
    res.on('close', () => {
      if (!doneSent) {
        // close before done = genuine client disconnect (navigation, tab close, etc.)
        aborted = true;
        this.logger.log('[AiGenerator] client disconnected (SSE close)');
      }
      // close after done = normal TCP teardown after response ended — ignore
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

      // Custom fetch that strips reasoning_content / thinking blocks from outgoing
      // messages before each API call. This prevents "reasoning_content must be
      // passed back" errors when the user is using a reasoning model (DeepSeek-R1,
      // QwQ, etc.) via a custom base URL: the @ai-sdk/openai adapter doesn't
      // preserve these non-standard fields when building multi-step message history.
      const strippedFetch: typeof fetch = async (url, options) => {
        if (options?.body && typeof options.body === 'string') {
          try {
            const body = JSON.parse(options.body);
            if (Array.isArray(body.messages)) {
              body.messages = body.messages.map((m: any) => {
                // Strip top-level reasoning_content field (DeepSeek-R1 style)
                const { reasoning_content, ...rest } = m;
                // If content is an array (Anthropic thinking blocks), keep only text blocks
                if (Array.isArray(rest.content)) {
                  const text = rest.content
                    .filter((b: any) => b.type === 'text')
                    .map((b: any) => b.text ?? '')
                    .join('');
                  rest.content = text;
                }
                return rest;
              });
            }
            return fetch(url as string, { ...options, body: JSON.stringify(body) });
          } catch {
            // JSON parse failed — pass through unchanged
          }
        }
        return fetch(url as string, options as RequestInit);
      };

      const openaiProvider = createOpenAI({
        baseURL: baseUrl.replace(/\/+$/, ''),
        apiKey: aiKey,
        fetch: strippedFetch,
      });
      const modelInstance = openaiProvider(model) as any;

      this.logger.log(`[AiGenerator] AI baseURL: ${baseUrl.replace(/\/+$/, '')}`);

      // Dynamically load entity agent tools when businessType is provided
      let entityTools: Record<string, any> = {};
      let entitySystemPrompt = '';
      if (dto.businessType) {
        const loaded = await this.loadEntityAgentTools(dto.businessType, userId);
        entityTools = loaded.tools;
        entitySystemPrompt = loaded.systemPrompt;
        if (Object.keys(entityTools).length > 0) {
          this.logger.log(`[AiGenerator] Loaded ${Object.keys(entityTools).length} entity agent tools for '${dto.businessType}'`);
        }
      }

      // ── Retry loop (autocode mode only: detect propose_entity hallucination) ──
      const MAX_RETRIES = 3;
      let calledProposeEntity = false;
      let textBuffer = '';

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (aborted) break;

        calledProposeEntity = false;
        textBuffer = '';

        if (attempt > 1) {
          this.logger.warn(`[AiGenerator] 🔄 retry attempt ${attempt}/${MAX_RETRIES}`);
          write({ kind: 'retry', attempt, maxRetries: MAX_RETRIES, content: '检测到未实际提交工具调用，正在重试…' });
          messages.push({
            role: 'user',
            content: '## ⚠️ 你上一轮的回复里描述了实体字段但**没有调用 propose_entity 工具**提交！你只是在文字里"说"了，但没有真正执行。请**现在立刻**调用 propose_entity 工具提交实体定义。不要再只描述不提交。如果涉及字典或 Package，也在同一轮调 create_dict / create_package。',
          });
        }

        const result = streamText({
          model: modelInstance,
          // entity agent mode: use entity-specific system prompt (user-defined or auto-generated)
          // autocode mode: use the standard code-generation system prompt
          system: Object.keys(entityTools).length > 0 ? entitySystemPrompt : AI_GENERATOR_SYSTEM_PROMPT,
          messages,
          // No hard step limit — let the model complete naturally.
          // Users can cancel via the frontend stop button; the server handles
          // res.on('close') for genuine disconnects.
          maxSteps: 200,
          tools: Object.keys(entityTools).length > 0 ? entityTools : {
            propose_entity: tool({
              description: PROPOSE_ENTITY_TOOL.function.description,
              parameters: jsonSchema(PROPOSE_ENTITY_TOOL.function.parameters as any),
              execute: async (args: any) => {
                calledProposeEntity = true;
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
                  .catch(() => [] as any[]),
              ]);
              if (existing.length > 0) {
                return { ok: false, error: `表 '${args.tableName}' 已存在(生成历史中有记录)。若要修改请用 update 流程；若要重建请先 delete_entity 删除后再 propose。` };
              }
              if (Array.from(physCheck as any).length) {
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
                    .catch(() => [] as any[]),
                ]);
                const histSet = new Set(histRows.map((r) => r.tableName));
                const physNames = Array.from(physRows as any).map((r: any) =>
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
              const safeCount = Math.min(Math.max(count ?? 10, 1), 100);
              try {
                const result = await this.autocodeService.generateMockForTable(tableName, safeCount, userId);
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
                // Primary: look up autocode history (has rich metadata)
                const rows = await this.db
                  .select({ fields: sysAutoCodeHistories.fields, version: sysAutoCodeHistories.version })
                  .from(sysAutoCodeHistories)
                  .where(eq(sysAutoCodeHistories.tableName, tableName))
                  .orderBy(sysAutoCodeHistories.version)
                  .limit(1);
                if (rows.length > 0 && rows[0].fields) {
                  const fields = (rows[0].fields as any[])
                    .filter((f) => !f.removed)
                    .map((f) => ({
                      name: f.name,
                      type: f.type,
                      description: f.description,
                      required: f.required,
                      ...(f.relationType ? { relationType: f.relationType, relationTable: f.relationTable } : {}),
                      ...(f.dictType ? { dictType: f.dictType } : {}),
                    }));
                  write({ kind: 'progress', content: `已获取 '${tableName}' 字段结构（${fields.length} 个字段，来自生成历史）` });
                  return { ok: true, tableName, source: 'history', fields };
                }

                // Fallback: sub-tables are never stored in history — read physical schema
                const physRows = await this.db.execute(
                  sql`SELECT column_name, data_type, is_nullable
                      FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = ${'lc_' + tableName}
                      ORDER BY ordinal_position`
                );
                const cols = Array.from(physRows as any[]);
                if (cols.length === 0) {
                  return { ok: false, tableName, error: `表 'lc_${tableName}' 不存在，请用 list_tables 确认名称` };
                }
                const fields = cols
                  .filter((c: any) => !['id','created_at','updated_at','deleted_at','owner_id','shared_with'].includes(c.column_name))
                  .map((c: any) => ({
                    name: c.column_name,
                    type: c.data_type,
                    required: c.is_nullable === 'NO',
                  }));
                write({ kind: 'progress', content: `已获取 '${tableName}' 字段结构（${fields.length} 个字段，来自物理表，为子表）` });
                return { ok: true, tableName, source: 'physical_schema', isSubTable: true, fields };
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
          list_btn_perms: tool({
            description: LIST_BTN_PERMS_TOOL.function.description,
            parameters: jsonSchema(LIST_BTN_PERMS_TOOL.function.parameters as any),
            execute: async (args: unknown) => {
              const { tableName } = (args as any) ?? {};
              try {
                const btns = await this.authorityBtnService.listBtnPerms(tableName);
                return { ok: true, tableName, buttons: btns };
              } catch (e: any) {
                return { ok: false, tableName, error: e?.message };
              }
            },
          }),

          add_custom_btn: tool({
            description: ADD_CUSTOM_BTN_TOOL.function.description,
            parameters: jsonSchema(ADD_CUSTOM_BTN_TOOL.function.parameters as any),
            execute: async (args: unknown) => {
              const { tableName, btnName, label, targetTable, sourceField, roles } = (args as any) ?? {};
              try {
                write({ kind: 'progress', content: `正在为 '${tableName}' 添加按钮 '${label}'…` });
                const result = await this.authorityBtnService.createCustomBtn({
                  tableName, btnName, label, targetTable, sourceField, roles,
                });
                write({ kind: 'progress', content: `按钮 '${label}' 已创建并授权给 ${roles.join(', ')}` });
                return { ok: true, tableName, btnName, id: result.id };
              } catch (e: any) {
                return { ok: false, tableName, btnName, error: e?.message };
              }
            },
          }),

          remove_custom_btn: tool({
            description: REMOVE_CUSTOM_BTN_TOOL.function.description,
            parameters: jsonSchema(REMOVE_CUSTOM_BTN_TOOL.function.parameters as any),
            execute: async (args: unknown) => {
              const { tableName, btnName } = (args as any) ?? {};
              try {
                write({ kind: 'progress', content: `正在删除 '${tableName}' 上的按钮 '${btnName}'…` });
                await this.authorityBtnService.removeCustomBtn(tableName, btnName);
                return { ok: true, tableName, btnName };
              } catch (e: any) {
                return { ok: false, tableName, btnName, error: e?.message };
              }
            },
          }),
        },
        onChunk: ({ chunk }: any) => {
          if (aborted) return;
          if (chunk.type === 'text-delta') {
            textBuffer += chunk.textDelta;
            write({ kind: 'token', content: chunk.textDelta });
          }
        },
      });

      for await (const _ of result.textStream) {
        if (aborted) break;
      }

      if (aborted) break;

      // ── Hallucination detection: autocode mode only ──
      // Model described creation ("已生成"/"已创建"/"字段总览") but never called propose_entity.
      const isEntityMode = Object.keys(entityTools).length > 0;
      if (!isEntityMode && !calledProposeEntity && this.isCreationHallucination(textBuffer)) {
        this.logger.warn(
          `[AiGenerator] ⚠ hallucination on attempt ${attempt}/${MAX_RETRIES}: ` +
          `model claimed creation but never called propose_entity (textLen=${textBuffer.length})`,
        );
        if (attempt < MAX_RETRIES) continue;
        write({ kind: 'warning', content: 'AI 多次描述实体方案但未实际调用提交工具，请尝试重新描述您的需求。' });
        break;
      }

      // Success (tool was called) or not an action attempt — done
      break;
    } // end retry loop

    if (!aborted) {
      doneSent = true;
      write({ kind: 'done' });
      res.end();
    }
  } catch (e: any) {
    this.logger.error(`[AiGenerator] ✗ 流式调用失败: ${e?.message}\n${e?.stack?.slice(0, 800)}`);
    if (!aborted) {
      doneSent = true;
      write({ kind: 'error', message: e?.message || 'AI 调用失败' });
      write({ kind: 'done' });
      res.end();
    }
  }
}

  /**
   * Detect creation hallucination: model claimed to have created/提交 an entity
   * in text but never actually called propose_entity.
   */
  private isCreationHallucination(text: string): boolean {
    // Must contain creation-claim keywords
    const creationClaims = ['已生成', '已创建', '已提交', '已为你生成', '表已就绪', '字段总览', '需要我插入 mock'];
    const hasClaim = creationClaims.some((kw) => text.includes(kw));
    if (!hasClaim) return false;

    // Must contain table-like structure indicators (field name + type pattern)
    const hasFieldTable = /`\w+`\s+(varchar|integer|text|decimal|boolean|timestamp|uuid|dict|relation|point|file|image|bigint)/i.test(text);
    if (!hasFieldTable) return false;

    return true;
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

  /**
   * Load entity agent tools from history record.
   * Queries sys_auto_code_histories for the latest agent config of the given
   * businessType entity, then builds dynamic tool definitions with parameterized
   * Drizzle SQL execute callbacks (no ModuleRef needed).
   */
  private async loadEntityAgentTools(businessType: string, userId?: string): Promise<{ tools: Record<string, any>; systemPrompt: string }> {
    const empty = { tools: {}, systemPrompt: '' };
    try {
      const rows = await this.db
        .select({ templates: sysAutoCodeHistories.templates })
        .from(sysAutoCodeHistories)
        .where(eq(sysAutoCodeHistories.tableName, businessType))
        .orderBy(desc(sysAutoCodeHistories.createdAt))
        .limit(1);

      if (rows.length === 0) return empty;

      const templates = rows[0].templates as Record<string, any> | null;
      const agentCfg = templates?.__agent as Record<string, any> | undefined;
      if (!agentCfg) return empty;

      const enabledTools: string[] = agentCfg.enabledTools ?? [];
      const tableName: string = agentCfg.tableName ?? businessType;
      const lcTable = `lc_${tableName}`;
      const visibilityStrategy: string = agentCfg.visibilityStrategy ?? 'private';
      const isAdmin = false; // entity tools don't have role info, fallback to non-admin

      // Build visibility WHERE fragment for SELECT tools.
      // private: owner only. shared: owner OR shared_with. department/public: no filter.
      const visFragment = (() => {
        if (visibilityStrategy === 'public') return sql``; // no filter
        if (visibilityStrategy === 'department') {
          // Simplified: just owner-only. Full dept scope needs OwnershipHelper.
          return sql`AND owner_id = ${userId ?? ''}`;
        }
        if (visibilityStrategy === 'shared') {
          const uid = userId ?? '';
          const sharedJson = JSON.stringify([uid]);
          return sql`AND (owner_id = ${uid} OR shared_with @> ${sql.raw(`'${sharedJson}'::jsonb`)})`;
        }
        // private (default): owner only
        return sql`AND owner_id = ${userId ?? ''}`;
      })();
      const creatableFields: any[] = agentCfg.creatableFields ?? [];
      const editableFields: any[] = agentCfg.editableFields ?? [];
      const searchableFields: any[] = agentCfg.searchableFields ?? [];

      const tools: Record<string, any> = {};

      const tbl = sql.identifier(lcTable);

      if (enabledTools.includes('query')) {
        tools[`query_${tableName}`] = tool({
          description: `【精确查询】按 UUID 获取单条 ${tableName} 记录。已知 ID 时用此工具；未知 ID 时先用 search_${tableName}。`,
          parameters: jsonSchema({
            type: 'object',
            properties: { id: { type: 'string', description: 'Record UUID' } },
            required: ['id'],
          }),
          execute: async (args: { id: string }) => {
            const res = await this.db.execute(
              sql`SELECT * FROM ${tbl} WHERE id = ${args.id} AND deleted_at IS NULL ${visFragment} LIMIT 1`,
            );
            const r = Array.from(res as any);
            if (r.length === 0) throw new Error(`${tableName} with id ${args.id} not found`);
            this.logger.log(`[EntityTool] query_${tableName} id=${args.id} → ${r.length} rows`);
            return r[0];
          },
        });
      }

      if (enabledTools.includes('create') && creatableFields.length > 0) {
        const colNames = creatableFields.map((f: any) => f.name);
        const props: Record<string, any> = {};
        const requiredCols: string[] = [];
        for (const f of creatableFields) {
          const jsType = f.type === 'integer' || f.type === 'bigint' ? 'number'
            : f.type === 'boolean' ? 'boolean' : 'string';
          props[f.name] = { type: jsType, description: f.description || f.name };
          if (f.required) requiredCols.push(f.name);
        }
        tools[`create_${tableName}`] = tool({
          description: `【写入】新建一条 ${tableName} 记录并立即写入数据库。用户要求"新增/创建/录入"时必须调用此工具完成操作，不要只用文字描述。`,
          parameters: jsonSchema({ type: 'object', properties: props, required: requiredCols }),
          execute: async (args: any) => {
            const colIdents = colNames.map((n: string) => sql.identifier(n));
            const vals = colNames.map((n: string) => sql`${args[n] ?? null}`);
            const ownerVal = userId ? sql`${userId}` : sql`gen_random_uuid()`;
            const res = await this.db.execute(sql`
              INSERT INTO ${tbl} (${sql.join(colIdents, sql`, `)}, owner_id)
              VALUES (${sql.join(vals, sql`, `)}, ${ownerVal})
              RETURNING *
            `);
            return Array.from(res as any)[0] ?? null;
          },
        });
      }

      if (enabledTools.includes('update') && editableFields.length > 0) {
        const colNames = editableFields.map((f: any) => f.name);
        const props: Record<string, any> = {
          id: { type: 'string', description: 'Record UUID' },
        };
        for (const f of editableFields) {
          const jsType = f.type === 'integer' || f.type === 'bigint' ? 'number'
            : f.type === 'boolean' ? 'boolean' : 'string';
          props[f.name] = { type: jsType, description: f.description || f.name };
        }
        tools[`update_${tableName}`] = tool({
          description: `【写入】更新一条 ${tableName} 记录。用户要求"修改/更新/编辑"时必须调用此工具，需先用 search_${tableName} 或 query_${tableName} 获取目标记录的 id。`,
          parameters: jsonSchema({ type: 'object', properties: props, required: ['id'] }),
          execute: async (args: any) => {
            const setPairs = colNames.map((n: string) => {
              const col = sql.identifier(n);
              return sql`${col} = ${args[n] ?? null}`;
            });
            const res = await this.db.execute(sql`
              UPDATE ${tbl}
              SET ${sql.join(setPairs, sql`, `)}, updated_at = NOW()
              WHERE id = ${args.id} AND owner_id = ${userId ?? ''} AND deleted_at IS NULL
              RETURNING *
            `);
            return Array.from(res as any)[0] ?? null;
          },
        });
      }

      if (enabledTools.includes('delete')) {
        tools[`delete_${tableName}`] = tool({
          description: `【写入】软删除一条 ${tableName} 记录（设置 deleted_at，不物理删除）。需先确认目标记录 id。`,
          parameters: jsonSchema({
            type: 'object',
            properties: { id: { type: 'string', description: 'Record UUID' } },
            required: ['id'],
          }),
          execute: async (args: { id: string }) => {
            await this.db.execute(
              sql`UPDATE ${tbl} SET deleted_at = NOW() WHERE id = ${args.id} AND owner_id = ${userId ?? ''} AND deleted_at IS NULL`,
            );
            this.logger.log(`[EntityTool] delete_${tableName} id=${args.id}`);
            return { deleted: args.id };
          },
        });
      }

      if (enabledTools.includes('search')) {
        const props: Record<string, any> = {
          page: { type: 'number', description: 'Page number (1-based)' },
          pageSize: { type: 'number', description: 'Items per page' },
        };
        for (const f of searchableFields) {
          if (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal') {
            props[`${f.name}Min`] = { type: 'number', description: `${f.description || f.name} minimum` };
            props[`${f.name}Max`] = { type: 'number', description: `${f.description || f.name} maximum` };
          } else if (f.type !== 'relation') {
            props[f.name] = { type: 'string', description: f.description || f.name };
          }
        }
        tools[`search_${tableName}`] = tool({
          description: `【查询】按条件筛选 ${tableName} 记录，支持分页。用户要求"查询/列出/找到/搜索"时调用。结果含各记录的 id，可直接传给 create_*/update_*/delete_* 工具。`,
          parameters: jsonSchema({ type: 'object', properties: props }),
          execute: async (args: any) => {
            const page = Math.max(args.page ?? 1, 1);
            const pageSize = Math.min(Math.max(args.pageSize ?? 10, 1), 100);
            const off = (page - 1) * pageSize;

            // Build filters
            const filters: any[] = [];
            for (const f of searchableFields) {
              const col = sql.identifier(f.name);
              if (f.type === 'integer' || f.type === 'bigint' || f.type === 'decimal') {
                if (args[`${f.name}Min`] != null) {
                  filters.push(sql`${col} >= ${args[`${f.name}Min`]}`);
                }
                if (args[`${f.name}Max`] != null) {
                  filters.push(sql`${col} <= ${args[`${f.name}Max`]}`);
                }
              } else if (f.type === 'varchar' || f.type === 'text') {
                if (args[f.name]) {
                  filters.push(sql`${col} ILIKE ${'%' + args[f.name] + '%'}`);
                }
              } else if (f.type !== 'relation') {
                if (args[f.name]) {
                  filters.push(sql`${col} = ${args[f.name]}`);
                }
              }
            }

            let countQ: any;
            let listQ: any;
            if (filters.length > 0) {
              countQ = sql`SELECT COUNT(*) as total FROM ${tbl} WHERE deleted_at IS NULL AND ${sql.join(filters, sql` AND `)} ${visFragment}`;
              listQ = sql`SELECT * FROM ${tbl} WHERE deleted_at IS NULL AND ${sql.join(filters, sql` AND `)} ${visFragment} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${off}`;
            } else {
              countQ = sql`SELECT COUNT(*) as total FROM ${tbl} WHERE deleted_at IS NULL ${visFragment}`;
              listQ = sql`SELECT * FROM ${tbl} WHERE deleted_at IS NULL ${visFragment} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${off}`;
            }
            const [countRes, listRes] = await Promise.all([
              this.db.execute(countQ),
              this.db.execute(listQ),
            ]);
            const total = Number((Array.from(countRes as any)[0] as any)?.total ?? 0);
            const listData = Array.from(listRes as any);
            this.logger.log(`[EntityTool] search_${tableName} → ${listData.length} rows (total=${total}) page=${page} size=${pageSize} tbl=${lcTable}`);
            return { list: listData, total, page, pageSize };
          },
        });
      }

      if (enabledTools.includes('mock')) {
        tools[`mock_${tableName}`] = tool({
          description: `【写入】为 ${tableName} 批量生成模拟测试数据（1-100条）。仅用于测试，不影响真实业务数据。`,
          parameters: jsonSchema({
            type: 'object',
            properties: { count: { type: 'number', description: 'Number of mock rows (1-100)' } },
          }),
          execute: async (args: { count?: number }) => {
            const result = await this.autocodeService.generateMockForTable(tableName, args.count ?? 10, userId);
            return { ok: true, inserted: result.inserted, ownerSet: !!userId };
          },
        });
      }

      // Discover and load sub-table tools (one-to-many children of this master table).
      // Sub-tables follow the naming pattern lc_<singular(master)>_<child> and are
      // NOT in sys_auto_code_histories — detect them via information_schema.
      const subTablePrefix = `lc_${tableName.replace(/s$/, '')}_`;
      const subTableRows = await this.db.execute(
        sql`SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name LIKE ${subTablePrefix + '%'}
              AND table_name != ${lcTable}
            ORDER BY table_name`
      );
      const subTables = Array.from(subTableRows as any[]).map((r: any) => String(r.table_name));

      for (const subLcTable of subTables) {
        // Derive a readable tool-name prefix: strip the lc_ and master prefix
        const subToolName = subLcTable.replace(/^lc_/, '');

        // Get columns for this sub-table
        const colRows = await this.db.execute(
          sql`SELECT column_name, data_type, is_nullable
              FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = ${subLcTable}
              ORDER BY ordinal_position`
        );
        const allCols = Array.from(colRows as any[]);
        const SYSTEM_COLS = new Set(['id', 'created_at', 'updated_at', 'deleted_at', 'owner_id', 'shared_with']);
        const dataCols = allCols.filter((c: any) => !SYSTEM_COLS.has(c.column_name));

        // FK column: any uuid column that ends with _id (e.g. voucher_id)
        const fkCol = dataCols.find((c: any) => c.column_name.endsWith('_id') && c.data_type === 'uuid');
        const userCols = dataCols.filter((c: any) => c !== fkCol);

        const subTbl = sql.identifier(subLcTable);

        // search sub-table rows by parent FK
        tools[`search_${subToolName}`] = tool({
          description: `【查询】查询子表 ${subLcTable} 的记录。传入 ${fkCol?.column_name ?? 'parent_id'} 可按父记录过滤。结果含各行 id，可用于后续的 update_/delete_ 操作。`,
          parameters: jsonSchema({
            type: 'object',
            properties: {
              ...(fkCol ? { [fkCol.column_name]: { type: 'string', description: `Parent ${tableName} UUID` } } : {}),
              page: { type: 'number' },
              pageSize: { type: 'number' },
            },
          }),
          execute: async (args: any) => {
            const page = Math.max(args.page ?? 1, 1);
            const pageSize = Math.min(args.pageSize ?? 50, 200);
            const off = (page - 1) * pageSize;
            const fkFilter = fkCol && args[fkCol.column_name]
              ? sql`AND ${sql.identifier(fkCol.column_name)} = ${args[fkCol.column_name]}`
              : sql``;
            const listRes = await this.db.execute(
              sql`SELECT * FROM ${subTbl} WHERE deleted_at IS NULL ${fkFilter} ORDER BY created_at ASC LIMIT ${pageSize} OFFSET ${off}`
            );
            return { list: Array.from(listRes as any), page, pageSize };
          },
        });

        // create a sub-table row
        if (userCols.length > 0) {
          const props: Record<string, any> = {};
          const required: string[] = [];
          if (fkCol) {
            props[fkCol.column_name] = { type: 'string', description: `Parent ${tableName} UUID (required)` };
            required.push(fkCol.column_name);
          }
          for (const c of userCols) {
            const jsType = c.data_type.includes('int') || c.data_type === 'numeric' ? 'number' : 'string';
            // For uuid columns that are not the FK, hint that a valid UUID from a related table is needed
            const desc = c.data_type === 'uuid'
              ? `UUID reference (use search_${c.column_name}s or search_${c.column_name} to get a valid ID)`
              : c.column_name;
            props[c.column_name] = { type: jsType, description: desc };
            if (c.is_nullable === 'NO' && c.column_name !== 'id') required.push(c.column_name);
          }
          tools[`create_${subToolName}`] = tool({
            description: `【写入】在子表 ${subLcTable} 中新建一条记录。${fkCol ? `"${fkCol.column_name}" 是父表外键，必须传入 search_${tableName} 返回的某条主键 id。` : ''}其余 uuid 类型字段同理，均须先查询对应表取得主键后再传入，不可凭空填写。`,
            parameters: jsonSchema({ type: 'object', properties: props, required }),
            execute: async (args: any) => {
              const allInsertCols = [...(fkCol ? [fkCol.column_name] : []), ...userCols.map((c: any) => c.column_name)];
              const colIdents = allInsertCols.map((n) => sql.identifier(n));
              const vals = allInsertCols.map((n) => sql`${args[n] ?? null}`);
              const res = await this.db.execute(
                sql`INSERT INTO ${subTbl} (${sql.join(colIdents, sql`, `)}) VALUES (${sql.join(vals, sql`, `)}) RETURNING *`
              );
              return Array.from(res as any)[0] ?? null;
            },
          });

          tools[`update_${subToolName}`] = tool({
            description: `【写入】按 id 更新子表 ${subLcTable} 中的一条记录。需先用 search_${subToolName} 获取目标行 id。`,
            parameters: jsonSchema({
              type: 'object',
              properties: { id: { type: 'string' }, ...props },
              required: ['id'],
            }),
            execute: async (args: any) => {
              const setPairs = userCols
                .filter((c: any) => args[c.column_name] !== undefined)
                .map((c: any) => sql`${sql.identifier(c.column_name)} = ${args[c.column_name]}`);
              if (setPairs.length === 0) return { updated: false };
              const res = await this.db.execute(
                sql`UPDATE ${subTbl} SET ${sql.join(setPairs, sql`, `)}, updated_at = NOW() WHERE id = ${args.id} AND deleted_at IS NULL RETURNING *`
              );
              return Array.from(res as any)[0] ?? null;
            },
          });

          tools[`delete_${subToolName}`] = tool({
            description: `【写入】软删除子表 ${subLcTable} 中的一条记录（设置 deleted_at）。需先确认目标行 id。`,
            parameters: jsonSchema({
              type: 'object',
              properties: { id: { type: 'string', description: 'Row UUID' } },
              required: ['id'],
            }),
            execute: async (args: { id: string }) => {
              await this.db.execute(
                sql`UPDATE ${subTbl} SET deleted_at = NOW() WHERE id = ${args.id} AND deleted_at IS NULL`
              );
              return { deleted: args.id };
            },
          });
        }

        // For non-FK uuid columns (like "account"), auto-load a search tool for the
        // referenced table so the model can look up valid UUIDs before inserting.
        const nonFkUuidCols = userCols.filter((c: any) => c.data_type === 'uuid');
        for (const uuidCol of nonFkUuidCols) {
          // Guess the referenced table name: try lc_<colName>s and lc_<colName>
          const guessedTables = [`lc_${uuidCol.column_name}s`, `lc_${uuidCol.column_name}`];
          for (const guessedTable of guessedTables) {
            const tableExists = await this.db.execute(
              sql`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${guessedTable} LIMIT 1`
            );
            if (Array.from(tableExists as any).length > 0 && !tools[`search_${uuidCol.column_name}s`] && !tools[`search_${uuidCol.column_name}`]) {
              const refTbl = sql.identifier(guessedTable);
              const refToolName = guessedTable.replace(/^lc_/, '');
              tools[`search_${refToolName}`] = tool({
                description: `【查询】查询 ${guessedTable} 的记录列表，每条记录包含其主键 "id"。` +
                  `子表外键字段 "${uuidCol.column_name}" 必须引用此表某条记录的主键 —— 先调本工具，再将结果中对应记录的 "id" 传给 create_${subToolName}。`,
                parameters: jsonSchema({
                  type: 'object',
                  properties: {
                    keyword: { type: 'string', description: 'Optional keyword to filter by name/code/title' },
                    page: { type: 'number' },
                    pageSize: { type: 'number' },
                  },
                }),
                execute: async (args: any) => {
                  const pageSize = Math.min(args.pageSize ?? 50, 200);
                  const listRes = await this.db.execute(
                    sql`SELECT * FROM ${refTbl} WHERE deleted_at IS NULL ORDER BY created_at ASC LIMIT ${pageSize}`
                  );
                  // Return only id + first few text columns to keep response concise
                  // and ensure the model sees the id field prominently
                  const rows = Array.from(listRes as any).map((r: any) => {
                    const textCols = Object.entries(r)
                      .filter(([k]) => !['owner_id','shared_with','created_at','updated_at','deleted_at'].includes(k))
                      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {} as any);
                    return textCols;
                  });
                  return {
                    note: `外键字段 "${uuidCol.column_name}" 必须引用以下某条记录的主键 "id"`,
                    list: rows,
                  };
                },
              });
              this.logger.log(`[EntityTool] auto-loaded search_${refToolName} for uuid FK column "${uuidCol.column_name}" in ${subLcTable}`);
              break;
            }
          }
        }

        this.logger.log(`[EntityTool] loaded sub-table tools for ${subLcTable} (${Object.keys(tools).filter(k => k.includes(subToolName)).length} tools)`);
      }

      // Build entity-specific system prompt.
      // Use user-defined systemPrompt if provided; otherwise generate a generic one.
      const subTableSummary = subTables.length > 0
        ? `\n\n关联子表：${subTables.map(t => `\`${t.replace(/^lc_/, '')}\``).join('、')}（可通过 search/create/update/delete 工具操作）。子表中凡是外键字段（引用其他表），必须先查询被引用表取得主键，再作为外键值传入，不可凭空填写。`
        : '';
      const customPrompt: string = agentCfg.systemPrompt?.trim() ?? '';
      const systemPrompt = customPrompt ||
        `你是「${tableName}」业务数据助手。${subTableSummary}

## 核心行为准则
1. **立即调用工具，不要先描述计划**：用户要求增/改/删时，直接调用对应的【写入】工具执行，不要先用文字描述"我将要做什么"再做。
2. **批量操作**：需要批量写入时（如初始化数据、批量创建），直接连续调用工具完成全部操作，中间不要输出任何进度文字或"我来继续第X批"之类的描述。全部工具调用完成后，再用一条消息汇总结果。
3. **工具调用顺序**：需要写入前如不知道 ID，先调【查询】工具取到 id，再调【写入】工具。
4. **外键约束**：子表中引用其他表的外键字段，必须先查询被引用表取得目标记录的主键，再将该主键传入写入工具。外键的值由被引用表的主键决定，不可凭空填写。
5. **结果用中文简洁说明**：调用完成后报告结果（成功几条、失败原因等），不要重复工具内部细节。
6. **不涉及建表、字典、Package**：这些不在你的职责范围内。`;

      return { tools, systemPrompt };
    } catch (e: any) {
      this.logger.error(`[AiGenerator] Failed to load entity agent tools for '${businessType}': ${e?.message}`);
      return empty;
    }
  }
}
