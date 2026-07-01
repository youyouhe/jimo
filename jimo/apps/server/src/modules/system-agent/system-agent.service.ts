import { Injectable, Logger, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { streamText, tool, jsonSchema } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { buildUserAgentTools } from './tools/user.tools';
import { buildDepartmentAgentTools } from './tools/department.tools';
import { buildEmployeeAgentTools } from './tools/employee.tools';
import { buildMenuAgentTools } from './tools/menu.tools';
import { buildPackageAgentTools } from './tools/package.tools';
import { USER_AGENT_PROMPT } from './prompts/user.prompt';
import { DEPARTMENT_AGENT_PROMPT } from './prompts/department.prompt';
import { EMPLOYEE_AGENT_PROMPT } from './prompts/employee.prompt';
import { MENU_AGENT_PROMPT } from './prompts/menu.prompt';
import { PACKAGE_AGENT_PROMPT } from './prompts/package.prompt';
import type { SystemAgentChatDto } from './system-agent.dto';
import { DATABASE_CONNECTION, type DrizzleDb } from '../../db/connection';

export interface AgentHeaders {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * System Agent Service.
 *
 * Streams AI responses as SSE to the client. Loads the correct toolset and
 * system prompt based on agentType (users / departments / employees).
 *
 * BYOC pattern: apiKey / baseUrl / model come from frontend request headers,
 * same as BPM Agent and AutoCode AiGenerator.
 */
@Injectable()
export class SystemAgentService {
  private readonly logger = new Logger(SystemAgentService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async streamChatToRes(
    dto: SystemAgentChatDto,
    headers: AgentHeaders,
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

    const { apiKey, baseUrl, model } = headers;
    const lastMsg = dto.messages?.at(-1)?.content ?? '';

    this.logger.log(
      `[SystemAgent] chat received | agentType=${dto.agentType} model=${model ?? '(none)'} lastMsg="${lastMsg.slice(0, 80)}"`,
    );

    if (!apiKey || !baseUrl || !model) {
      write({ kind: 'error', message: '缺少 AI 配置(apiKey / baseUrl / model)' });
      write({ kind: 'done' });
      res.end();
      return;
    }

    // Select tools + system prompt
    const { rawTools, systemPrompt } = this.loadAgent(dto.agentType);

    let aborted = false;
    let doneSent = false;
    res.on('close', () => {
      if (!doneSent) {
        aborted = true;
        this.logger.log('[SystemAgent] client disconnected (SSE close)');
      }
    });

    try {
      // Intercept non-2xx responses so ai-sdk doesn't hang
      const checkResp = async (resp: globalThis.Response): Promise<globalThis.Response> => {
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          const err: any = new Error(`AI API 错误 ${resp.status}: ${body.slice(0, 200)}`);
          err.name = 'AiApiError';
          throw err;
        }
        return resp;
      };

      // Strip reasoning_content from messages to avoid some API compatibility issues
      const strippedFetch = async (
        url: string | URL | Request,
        options?: RequestInit,
      ): Promise<globalThis.Response> => {
        if (options?.body && typeof options.body === 'string') {
          try {
            const body = JSON.parse(options.body);
            if (Array.isArray(body.messages)) {
              body.messages = body.messages.map((m: any) => {
                const { reasoning_content, ...rest } = m;
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
            return checkResp(
              await fetch(url as string, { ...options, body: JSON.stringify(body) }),
            );
          } catch (e) {
            if ((e as any)?.name === 'AiApiError') throw e;
          }
        }
        return checkResp(await fetch(url as string, options as RequestInit));
      };

      const openaiProvider = createOpenAI({
        baseURL: baseUrl.replace(/\/+$/, ''),
        apiKey,
        fetch: strippedFetch,
      });
      const modelInstance = openaiProvider(model) as any;

      // Wrap raw tool definitions in Vercel AI SDK tool() calls, with logging
      const tools: Record<string, any> = {};
      for (const [toolName, toolDef] of Object.entries(rawTools)) {
        const rawDef = toolDef as any;
        tools[toolName] = tool({
          description: rawDef.description,
          parameters: jsonSchema(rawDef.parameters as any),
          execute: async (args: any) => {
            const argStr = JSON.stringify(args).slice(0, 200);
            this.logger.log(`[SystemAgent] ▶ tool ${toolName} args=${argStr}`);
            const start = Date.now();
            try {
              const result = await rawDef.execute(args);
              const resultPreview = typeof result === 'object'
                ? `keys=[${Object.keys(result ?? {}).join(',')}]` + ('total' in (result ?? {}) ? ` total=${(result as any).total}` : '') + ('list' in (result ?? {}) ? ` rows=${(result as any).list?.length ?? 0}` : '') + ('idMap' in (result ?? {}) ? ` idMap=${(result as any).idMap?.length ?? 0}` : '')
                : String(result).slice(0, 100);
              this.logger.log(`[SystemAgent] ✓ tool ${toolName} (${Date.now() - start}ms) → ${resultPreview}`);
              return result;
            } catch (e: any) {
              this.logger.warn(`[SystemAgent] ✗ tool ${toolName} (${Date.now() - start}ms) error: ${e.message}`);
              // Return error as result instead of throwing — lets the SDK feed
              // it back to the LLM so the user sees the error in-chat.
              return { error: e.message };
            }
          },
        });
      }

      // Build messages from conversation history
      const messages: any[] = (dto.messages ?? []).map((m: any) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

      const MAX_RETRIES = 3;
      let lastToolError: string | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (aborted) break;

        if (attempt > 1 && lastToolError) {
          this.logger.warn(`[SystemAgent] retry attempt ${attempt}/${MAX_RETRIES} lastError="${String(lastToolError).slice(0, 80)}"`);
          messages.push({
            role: 'user',
            content: `上一轮工具调用失败：${lastToolError}。请重试，确保工具参数从之前的 search/query 返回结果中精确复制。不要编造 UUID。`,
          });
          lastToolError = null;
        }

        lastToolError = null;

        const result = streamText({
        model: modelInstance,
        system: systemPrompt,
        messages,
        maxSteps: 200,
        tools,
        onChunk: ({ chunk }: any) => {
          if (aborted) return;
          if (chunk.type === 'text-delta') {
            write({ kind: 'token', content: chunk.textDelta });
          } else if (chunk.type === 'reasoning') {
            if (chunk.textDelta) {
              write({ kind: 'progress', content: chunk.textDelta });
            }
          } else if (chunk.type === 'tool-call') {
            const argSummary = Object.entries(chunk.args ?? {})
              .slice(0, 4)
              .map(([k, v]) => {
                const val = typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v).slice(0, 40);
                return `${k}=${val}`;
              })
              .join(', ');
            write({ kind: 'progress', content: argSummary ? `${chunk.toolName}(${argSummary})` : chunk.toolName });
          } else if (chunk.type === 'tool-result') {
            const result = chunk.result;
            if (result && typeof result === 'object') {
              let summary = '';
              if ('error' in result) {
                const errStr = String(result.error);
                summary = `失败: ${errStr.slice(0, 120)}`;
                lastToolError = errStr;
                // Also emit as error so frontend shows it prominently
                write({ kind: 'error', message: `工具 ${chunk.toolName} 执行失败: ${errStr.slice(0, 200)}` });
              } else if ('list' in result && 'total' in result) {
                summary = `${result.total} 条结果`;
              } else if ('deleted' in result) {
                summary = `已删除: ${(result as any).name ?? (result as any).username ?? (result as any).deleted}`;
              } else if ('created' in result) {
                summary = `已创建: ${JSON.stringify(result.created).slice(0, 60)}`;
              } else if ('updated' in result) {
                summary = `已更新: ${result.updated}`;
              } else {
                summary = JSON.stringify(result).slice(0, 80);
              }
              write({ kind: 'progress', content: `  -> ${summary}` });
            }
          } else if (chunk.type === 'error') {
            const errMsg = (chunk as any).error?.message ?? String((chunk as any).error ?? '');
            write({ kind: 'error', message: errMsg.slice(0, 300) });
          }
        },
      });

        let streamApiError: any = null;
        for await (const chunk of result.fullStream) {
          if (aborted) break;
          if ((chunk as any).type === 'error') {
            streamApiError = (chunk as any).error ?? new Error('AI 返回错误');
            this.logger.error(`[SystemAgent] fullStream error: ${streamApiError?.message}`);
            break;
          }
        }

        if (streamApiError) {
          write({ kind: 'error', message: (streamApiError as any)?.message || String(streamApiError) });
          write({ kind: 'done' });
          res.end();
          return;
        }

        // Retry if tool errors occurred and we haven't exceeded max retries
        if (!lastToolError) break;
        if (attempt < MAX_RETRIES) continue;
      } // end retry loop

      if (!aborted) {
        doneSent = true;
        write({ kind: 'done' });
        res.end();
      }
    } catch (e: any) {
      this.logger.error(`[SystemAgent] stream failed: ${e?.message}\n${e?.stack?.slice(0, 400)}`);
      if (!aborted) {
        doneSent = true;
        write({ kind: 'error', message: e?.message || 'AI 调用失败' });
        write({ kind: 'done' });
        res.end();
      }
    }
  }

  private loadAgent(agentType: 'users' | 'departments' | 'employees' | 'menus' | 'packages'): {
    rawTools: Record<string, any>;
    systemPrompt: string;
  } {
    switch (agentType) {
      case 'users':
        return { rawTools: buildUserAgentTools(this.db), systemPrompt: USER_AGENT_PROMPT };
      case 'departments':
        return { rawTools: buildDepartmentAgentTools(this.db), systemPrompt: DEPARTMENT_AGENT_PROMPT };
      case 'employees':
        return { rawTools: buildEmployeeAgentTools(this.db), systemPrompt: EMPLOYEE_AGENT_PROMPT };
      case 'menus':
        return { rawTools: buildMenuAgentTools(this.db), systemPrompt: MENU_AGENT_PROMPT };
      case 'packages':
        return { rawTools: buildPackageAgentTools(this.db), systemPrompt: PACKAGE_AGENT_PROMPT };
      default:
        throw new Error(`Unknown agentType: ${agentType}`);
    }
  }
}
