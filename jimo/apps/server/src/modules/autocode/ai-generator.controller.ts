import { Controller, Post, Body, Headers, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AiGeneratorService } from './ai-generator.service';
import { AiChatRequestDto } from './ai-generator.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';

/**
 * AI 实体生成器控制器。
 *
 * 注意:用 @Post + @Res() 手动写 SSE,而非 @Sse()。
 * 原因:全局 ResponseInterceptor 会把 @Sse 的 Observable<MessageEvent> 包成
 * { code, msg, data } 信封,破坏 SSE 流;@Res() 绕过拦截器,直接写 res。
 *
 * BYOC:apiKey / baseUrl / model 由前端从 sessionStorage 经自定义 header 传入,
 * 后端仅用于本次请求转发,不落盘。
 */
@ApiTags('autocode')
@ApiBearerAuth()
@Controller('autocode')
export class AiGeneratorController {
  constructor(private readonly aiService: AiGeneratorService) {}

  @Post('ai-chat')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'AI 对话生成实体(SSE 流式;BYOC key 经 header 传入)' })
  async aiChat(
    @Body() dto: AiChatRequestDto,
    @Headers('x-ai-api-key') aiKey?: string,
    @Headers('x-ai-base-url') baseUrl?: string,
    @Headers('x-ai-model') model?: string,
    @Res() res?: Response,
  ): Promise<void> {
    return this.aiService.streamChatToRes(dto, aiKey, baseUrl, model, res!);
  }

  @Post('ai-test')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: '测试 AI 配置连通性(BYOC key 经 header,非流式)' })
  async aiTest(
    @Headers('x-ai-api-key') aiKey?: string,
    @Headers('x-ai-base-url') baseUrl?: string,
    @Headers('x-ai-model') model?: string,
  ): Promise<{ ok: boolean; message: string }> {
    return this.aiService.testConnection(aiKey, baseUrl, model);
  }
}
