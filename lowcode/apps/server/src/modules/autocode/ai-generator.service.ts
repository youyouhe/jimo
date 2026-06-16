import { Injectable, Logger, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { AI_GENERATOR_SYSTEM_PROMPT } from './ai-generator.prompt';
import { PROPOSE_ENTITY_TOOL, CREATE_DICT_TOOL, CREATE_PACKAGE_TOOL, ALL_TOOLS } from './ai-generator.tool';
import type { AiChatRequestDto } from './ai-generator.dto';
import { DATABASE_CONNECTION, type DrizzleDb } from '../../db/connection';
import { sysDictionaries } from '../../db/schema/dictionaries';
import { sysDictionaryDetails } from '../../db/schema/dictionary-details';
import { sysAutoCodePackages } from '../../db/schema/auto-code-packages';
import { sysAutoCodeHistories } from '../../db/schema/auto-code-histories';
import { AutocodeService } from './autocode.service';

// 多轮 tool calling 上限。放开到较大值,允许「建包→建字典→提多张表」这类正常流程
// 不会被硬上限截断;真正的终止由「出现 propose」或「连续多轮零工具纯文本」决定。
const MAX_ROUNDS = 12;
// 一轮里零工具调用时,注入提示让 AI 补提的最多重试次数。超过即视为纯文本对话结束。
const MAX_NO_TOOL_RETRIES = 2;

interface ToolCallAcc {
  id: string;
  name: string;
  args: string;
}

/**
 * AI 实体生成器服务。
 *
 * 多轮 tool calling 流程:
 *  1. 用户描述需求 → AI 检查现有字典
 *  2. 若无匹配字典,AI 调 create_dict → 后端执行 → 返回 dictType
 *  3. AI 调 propose_entity(含正确 dictType) → 前端展示方案卡
 *  4. 用户确认 → 前端调现有 autocode/generate
 *
 * loop 终止策略:
 *  - 出现 propose_entity → 下发方案并结束(成功路径)
 *  - 连续 MAX_NO_TOOL_RETRIES+1 轮零工具纯文本 → 视为普通对话结束
 *  - 累计 MAX_ROUNDS 轮未收敛 → 返回「达到最大轮次」错误(兜底,防失控)
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

    if (!aiKey || !baseUrl || !model) {
      write({ kind: 'error', message: '缺少 AI 配置(apiKey / baseUrl / model)' });
      write({ kind: 'done' });
      res.end();
      return;
    }

    let aborted = false;
    res.on('close', () => {
      aborted = true;
    });

    try {
      const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';

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

      const messages: Array<{ role: string; content: string; tool_calls?: any; tool_call_id?: string; name?: string }> = [
        { role: 'system', content: systemWithCtx },
        ...dto.messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      // ── 多轮 tool calling 循环 ──
      let noToolStreak = 0; // 连续零工具轮次计数,用于判定"纯文本对话结束"
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (aborted) break;

        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            tools: ALL_TOOLS,
            tool_choice: 'auto',
          }),
        });

        if (!resp.ok || !resp.body) {
          const text = await resp.text().catch(() => '');
          throw new Error(`AI 服务返回 ${resp.status}: ${text.slice(0, 500)}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const toolCallsByIdx = new Map<number, ToolCallAcc>();
        let collectedText = ''; // 累积本轮 assistant 文字(用于零工具回退时回填 messages)

        while (true) {
          if (aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const raw of lines) {
            const line = raw.trim();
            if (!line || !line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            let chunk: any;
            try { chunk = JSON.parse(data); } catch { continue; }
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;
            // token 流式转发给前端
            if (typeof delta.content === 'string' && delta.content) {
              collectedText += delta.content;
              write({ kind: 'token', content: delta.content });
            }
            // 累积 tool_calls(按 index 分片)
            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx: number = tc.index ?? 0;
                let acc = toolCallsByIdx.get(idx);
                if (!acc) {
                  acc = { id: tc.id || '', name: tc.function?.name || '', args: '' };
                  toolCallsByIdx.set(idx, acc);
                }
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name = tc.function.name;
                acc.args += tc.function?.arguments || '';
              }
            }
          }
        }

        // 流结束 → 分类 tool_calls
        const createDictArgs: any[] = [];
        const createPackageArgs: any[] = [];
        const proposeArgs: any[] = [];
        const assistantToolCalls: any[] = [];

        for (const acc of toolCallsByIdx.values()) {
          let parsed: any;
          try { parsed = JSON.parse(acc.args); } catch { /* 未完成 */ continue; }
          assistantToolCalls.push({
            id: acc.id,
            type: 'function',
            function: { name: acc.name, arguments: acc.args },
          });
          if (acc.name === 'propose_entity') proposeArgs.push(parsed);
          else if (acc.name === 'create_dict') createDictArgs.push({ id: acc.id, args: parsed });
          else if (acc.name === 'create_package') createPackageArgs.push({ id: acc.id, args: parsed });
        }

        // ── 分发 ──
        // 顺序:先执行 create_dict/create_package(本地落库),再下发 propose_entity(若有,同轮终止),
        // 否则按"有工具(仅字典/包)→ 下一轮"或"零工具 → 补提重试 / 纯文本结束"处理。
        let hadToolThisRound = false;

        if (createDictArgs.length > 0 || createPackageArgs.length > 0) {
          hadToolThisRound = true;
          // 本地执行 create_dict / create_package,构造 tool results
          const toolResults: any[] = [];
          if (createDictArgs.length > 0) {
            write({ kind: 'progress', content: `正在创建 ${createDictArgs.length} 个字典…` });
          }
          if (createPackageArgs.length > 0) {
            write({ kind: 'progress', content: `正在创建 ${createPackageArgs.length} 个 Package…` });
          }
          for (const cd of createDictArgs) {
            const result = await this.executeCreateDict(cd.args);
            toolResults.push({
              role: 'tool' as const,
              tool_call_id: cd.id,
              content: JSON.stringify(result),
            });
          }
          for (const cp of createPackageArgs) {
            const result = await this.executeCreatePackage(cp.args);
            toolResults.push({
              role: 'tool' as const,
              tool_call_id: cp.id,
              content: JSON.stringify(result),
            });
          }
          // 追加 assistant tool_calls + tool results 到 messages
          messages.push({ role: 'assistant', content: '', tool_calls: assistantToolCalls } as any);
          for (const tr of toolResults) messages.push(tr as any);
          // 不在此 return:若同轮也产出了 propose,下方块会一并下发并终止;
          // 若没有 propose,则落到下方"有工具但无 propose → 下一轮"分支。
        }

        if (proposeArgs.length > 0) {
          for (const dto of proposeArgs) {
            if (dto.packageId) {
              try {
                const pkg = await this.autocodeService.findOnePackage(dto.packageId);
                if (pkg) dto.packageName = pkg.name;
              } catch { /* silent — ProposeCard will fallback to truncated UUID */ }
            }
            write({ kind: 'tool_result', dto });
          }
          write({ kind: 'done' });
          res.end();
          return;
        }

        // 本轮无 propose
        if (hadToolThisRound) {
          // 本轮执行了字典/包(已回填 tool results),但还没 propose → 让 AI 基于结果继续提议
          noToolStreak = 0;
          continue;
        }

        // ── 本轮零工具调用 ──
        // 先把模型这一轮的文字答复回填进 messages(它可能输出了设计描述),再决定是否补提。
        messages.push({ role: 'assistant', content: collectedText || '' } as any);
        noToolStreak += 1;
        if (noToolStreak <= MAX_NO_TOOL_RETRIES && (collectedText || '').trim().length > 0) {
          // 注入提示,要求 AI 直接补提(消灭"只描述不提交");仅在模型上轮确实输出了文字时触发,
          // 空白输出(模型在等澄清/异常)→ 不强求工具,正常结束。
          write({ kind: 'progress', content: 'AI 未调用工具,已要求其直接提交方案…', fallback: true });
          messages.push({
            role: 'system',
            content:
              '你上一轮没有调用任何工具。提醒:凡涉及"建表/设计实体"的需求,必须调用 propose_entity 提交方案(多表则逐个调用),不要只用文字描述。如果是建表请求,请现在直接用 propose_entity 补提所有相关表;只有在等用户澄清需求时,才用纯文字回复。',
          } as any);
          continue; // 再跑一轮,给模型补提的机会
        }
        // 真正的纯文本对话(澄清/闲聊),或补提次数用尽仍无工具 → 结束
        write({ kind: 'done' });
        res.end();
        return;
      }

      // 累计 MAX_ROUNDS 轮仍未收敛(极少触发,兜底防失控)
      write({ kind: 'error', message: 'AI 对话达到最大轮次,请重新对话或换种描述' });
      write({ kind: 'done' });
      res.end();
    } catch (e: any) {
      this.logger.error(`[AiGenerator] 流式调用失败: ${e?.message}`);
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
