import { Injectable, Logger, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { streamText, tool, jsonSchema, type CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { AI_GENERATOR_SYSTEM_PROMPT } from './ai-generator.prompt';
import { PROPOSE_ENTITY_TOOL, CREATE_DICT_TOOL, CREATE_PACKAGE_TOOL } from './ai-generator.tool';
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
 *  1. 用户描述需求 → AI 检查现有字典
 *  2. 若无匹配字典,AI 调 create_dict → 后端执行 → 返回 dictType
 *  3. AI 调 propose_entity(含正确 dictType) → 前端展示方案卡
 *  4. 用户确认 → 前端调现有 autocode/generate
 *
 * 使用 Vercel AI SDK streamText() 驱动多步 tool calling,maxSteps: 12 替代手动 for 循环。
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
      // 运行时查现有字典列表 → 追加到 system prompt
      let dictCtx = '';
      try {
        const dictRows = await this.db
          .select({ type: sysDictionaries.type, name: sysDictionaries.name })
          .from(sysDictionaries)
          .limit(100);
        dictCtx = dictRows.map((d) => `\`${d.type}\` — ${d.name}`).join('\n');
      } catch {
        dictCtx = '(查询失败)';
      }

      // 运行时查现有 Package 列表 → 追加到 system prompt
      let packageCtx = '';
      try {
        const pkgRows = await this.db
          .select({ id: sysAutoCodePackages.id, name: sysAutoCodePackages.name })
          .from(sysAutoCodePackages)
          .limit(100);
        packageCtx = pkgRows.map((p) => `\`${p.id}\` — ${p.name}`).join('\n');
      } catch {
        packageCtx = '(查询失败)';
      }

      // 运行时查已生成实体列表 → 追加到 system prompt(避免 AI 重复创建)
      let entityCtx = '';
      try {
        const entityRows = await this.db
          .selectDistinct({ tableName: sysAutoCodeHistories.tableName })
          .from(sysAutoCodeHistories);
        entityCtx = entityRows.map((e) => `\`${e.tableName}\``).join(', ');
      } catch {
        entityCtx = '(查询失败)';
      }

      // 结构化运行时上下文:清晰的分段标签 + 顶部硬约束,降低模型忽略的概率。
      const systemWithCtx =
        AI_GENERATOR_SYSTEM_PROMPT +
        '\n\n## ⛔ 已生成的实体表(这些表已存在,绝对不要再提议同名表;relation 可直接引用)\n' +
        (entityCtx || '(暂无已生成实体)') +
        '\n\n## 📕 现有字典(优先匹配下列 dictType;若都不匹配再调 create_dict 创建)\n' +
        (dictCtx || '(暂无字典)') +
        '\n\n## 📦 现有 Package(用户指定 package 时按名称匹配;无匹配且用户明确要 package 再 create_package)\n' +
        (packageCtx || '(暂无 Package)');

      const messages = dto.messages.map((m) => ({ role: m.role, content: m.content }));

      const openaiProvider = createOpenAI({ baseURL: baseUrl.replace(/\/+$/, ''), apiKey: aiKey });
      // Cast to any: @ai-sdk/openai@3 returns LanguageModelV3 but ai@4 expects LanguageModelV1.
      // The protocol difference is only in TypeScript types; runtime behavior is compatible.
      const modelInstance = openaiProvider(model) as any;

      this.logger.log(`[AiGenerator] AI baseURL: ${baseUrl.replace(/\/+$/, '')}`);

      const result = streamText({
        model: modelInstance,
        system: systemWithCtx,
        messages: messages as CoreMessage[],
        maxSteps: 12,
        tools: {
          propose_entity: tool({
            description: PROPOSE_ENTITY_TOOL.function.description,
            parameters: jsonSchema(PROPOSE_ENTITY_TOOL.function.parameters as any),
            execute: async (args: any) => {
              this.logger.log(`[AiGenerator] ✓ propose_entity: ${args.tableName}`);
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
              const result = await this.executeCreateDict(args);
              return result;
            },
          }),
          create_package: tool({
            description: CREATE_PACKAGE_TOOL.function.description,
            parameters: jsonSchema(CREATE_PACKAGE_TOOL.function.parameters as any),
            execute: async (args: any) => {
              write({ kind: 'progress', content: `正在创建 Package "${args.name}"…` });
              const result = await this.executeCreatePackage(args);
              return result;
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

      // Consume the stream (required to trigger onChunk callbacks and tool execution)
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

  /** 执行 create_dict:插入字典大类 + 明细项,返回 dictType 供 AI 引用 */
  private async executeCreateDict(args: {
    type: string;
    name: string;
    items: Array<{ label: string; value: string }>;
  }): Promise<{ ok: boolean; dictType: string; message: string }> {
    const { type, name, items = [] } = args;
    try {
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

  /** 执行 create_package:插入 Package 记录,返回 packageId 和 name 供 AI 引用 */
  private async executeCreatePackage(args: {
    name: string;
    description?: string;
  }): Promise<{ ok: boolean; packageId: string; name: string; message: string }> {
    const { name, description } = args;
    try {
      const pkg = await this.autocodeService.createPackage({
        name,
        description: description || '',
        templates: {},
      });
      const packageId = pkg.id;
      this.logger.log(
        `[AiGenerator] create_package ✓ name="${name}" id=${packageId}`,
      );
      return { ok: true, packageId, name, message: `Package "${name}" 创建成功` };
    } catch (e: any) {
      this.logger.error(`[AiGenerator] create_package ✗ name="${name}": ${e?.message}`);
      return { ok: false, packageId: '', name, message: `创建 Package 失败: ${e?.message}` };
    }
  }

  /** 测试 BYOC 配置连通性(非流式极简请求) */
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
