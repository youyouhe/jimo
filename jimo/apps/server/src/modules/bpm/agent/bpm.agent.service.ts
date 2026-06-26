import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { streamText, tool, jsonSchema } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { BPM_AGENT_SYSTEM_PROMPT } from './bpm.agent.prompts';
import { buildBpmAgentTools } from './bpm.agent.tools';
import type { LfGraphData } from './bpm.agent.tools';

export interface BpmAgentChatDto {
  message: string;
  lfJson?: LfGraphData;
}

export interface AgentHeaders {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * BPM Designer Agent Service.
 *
 * Streams AI responses as SSE to the client.
 * Handles canvas_update tool results by emitting a special SSE event
 * so the frontend can call lf.render() to update the canvas.
 *
 * Uses the same BYOC (Bring Your Own Credentials) pattern as AiGeneratorService:
 * apiKey / baseUrl / model come from frontend request headers.
 */
@Injectable()
export class BpmAgentService {
  private readonly logger = new Logger(BpmAgentService.name);

  constructor(private readonly config: ConfigService) {}

  async streamChatToRes(
    dto: BpmAgentChatDto,
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

    this.logger.log(
      `[BpmAgent] chat received | model=${model ?? '(none)'} baseUrl=${baseUrl ?? '(none)'} keyLen=${apiKey?.length ?? 0} msg="${dto.message.slice(0, 80)}"`,
    );

    if (!apiKey || !baseUrl || !model) {
      write({ kind: 'error', message: '缺少 AI 配置(apiKey / baseUrl / model)' });
      write({ kind: 'done' });
      res.end();
      return;
    }

    let aborted = false;
    let doneSent = false;
    res.on('close', () => {
      if (!doneSent) {
        aborted = true;
        this.logger.log('[BpmAgent] client disconnected (SSE close)');
      }
    });

    try {
      // Intercept non-2xx responses so ai-sdk doesn't hang on error streams.
      const checkResp = async (resp: globalThis.Response): Promise<globalThis.Response> => {
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          const err: any = new Error(`AI API 错误 ${resp.status}: ${body.slice(0, 200)}`);
          err.name = 'AiApiError';
          throw err;
        }
        return resp;
      };

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

      // Build tools with current lfJson context embedded via closures
      const rawTools = buildBpmAgentTools(this.config);

      // Wrap each raw tool definition (plain objects) into Vercel AI SDK tool() calls
      const tools: Record<string, any> = {};
      for (const [toolName, toolDef] of Object.entries(rawTools)) {
        const rawDef = toolDef as any;
        tools[toolName] = tool({
          description: rawDef.description,
          parameters: jsonSchema(rawDef.parameters as any),
          execute: async (args: any) => {
            // Inject lfJson from dto if the tool expects it and caller didn't provide one
            if ('lfJson' in rawDef.parameters.properties && !args.lfJson && dto.lfJson) {
              args.lfJson = dto.lfJson;
            }
            return rawDef.execute(args);
          },
        });
      }

      // Build conversation messages: user message with optional canvas state context
      const canvasContext = dto.lfJson
        ? `\n\n[当前画布状态: ${(dto.lfJson.nodes ?? []).length} 个节点, ${(dto.lfJson.edges ?? []).length} 条连线]`
        : '';

      const result = streamText({
        model: modelInstance,
        system: BPM_AGENT_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: dto.message + canvasContext,
          },
        ],
        maxSteps: 15,
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
            const args = chunk.args ?? {};
            const argSummary = Object.entries(args)
              .filter(([k]) => k !== 'lfJson')
              .slice(0, 4)
              .map(([k, v]) => {
                const val =
                  typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v).slice(0, 40);
                return `${k}=${val}`;
              })
              .join(', ');
            const label = argSummary
              ? `${chunk.toolName}(${argSummary})`
              : chunk.toolName;
            write({ kind: 'progress', content: `${label}` });
          } else if (chunk.type === 'tool-result') {
            const result = chunk.result;
            // Handle canvas_update specially — emit dedicated event for frontend
            if (result && typeof result === 'object' && result.type === 'canvas_update') {
              write({
                kind: 'canvas_update',
                data: { lfJson: result.lfJson, message: result.message },
              });
              write({ kind: 'progress', content: `画布已更新: ${result.message ?? ''}` });
            } else if (result && typeof result === 'object') {
              // Compact summary for other tool results
              let summary = '';
              if ('error' in result) {
                summary = `失败: ${String(result.error).slice(0, 80)}`;
              } else if ('nodeCount' in result) {
                summary = `画布: ${result.nodeCount} 节点, ${result.edgeCount} 边`;
              } else if ('rules' in result) {
                const rules = (result.rules as any[]) ?? [];
                summary = `可用规则: ${rules.map((r: any) => r.name).join(', ')}`;
              } else {
                summary = 'done';
              }
              write({ kind: 'progress', content: `  -> ${summary}` });
            }
          }
        },
      });

      let streamApiError: any = null;
      for await (const chunk of result.fullStream) {
        if (aborted) break;
        if ((chunk as any).type === 'error') {
          streamApiError = (chunk as any).error ?? new Error('AI 返回错误');
          this.logger.error(`[BpmAgent] fullStream error: ${streamApiError?.message}`);
          break;
        }
      }

      if (streamApiError) {
        const msg = (streamApiError as any)?.message || String(streamApiError);
        write({ kind: 'error', message: msg });
        write({ kind: 'done' });
        res.end();
        return;
      }

      if (!aborted) {
        doneSent = true;
        write({ kind: 'done' });
        res.end();
      }
    } catch (e: any) {
      this.logger.error(`[BpmAgent] stream failed: ${e?.message}\n${e?.stack?.slice(0, 400)}`);
      if (!aborted) {
        doneSent = true;
        write({ kind: 'error', message: e?.message || 'AI 调用失败' });
        write({ kind: 'done' });
        res.end();
      }
    }
  }
}
