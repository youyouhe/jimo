import { Controller, Post, Body, Headers, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemAgentService } from './system-agent.service';
import { SystemAgentChatDto } from './system-agent.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * System Agent Controller.
 *
 * SSE streaming endpoint at POST /api/v1/system-agent/chat.
 * BYOC: apiKey / baseUrl / model from frontend headers (shared with autocode LLM config).
 */
@ApiTags('System Agent')
@ApiBearerAuth()
@Controller('system-agent')
export class SystemAgentController {
  constructor(private readonly systemAgentService: SystemAgentService) {}

  @Post('chat')
  @ApiOperation({ summary: '系统模块 AI 助手 (SSE 流式; BYOC key 经 header 传入)' })
  async chat(
    @Body() dto: SystemAgentChatDto,
    @Headers('x-api-key') apiKey?: string,
    @Headers('x-base-url') baseUrl?: string,
    @Headers('x-model') model?: string,
    @Res() res?: Response,
    @CurrentUser() user?: { sub: string },
  ): Promise<void> {
    return this.systemAgentService.streamChatToRes(
      dto,
      { apiKey: apiKey ?? '', baseUrl: baseUrl ?? '', model: model ?? '' },
      res!,
      user?.sub,
    );
  }
}
