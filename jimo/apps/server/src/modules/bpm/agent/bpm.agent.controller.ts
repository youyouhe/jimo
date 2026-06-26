import { Controller, Post, Body, Headers, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BpmAgentService } from './bpm.agent.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

export class BpmAgentChatBodyDto {
  @ApiProperty({ description: '用户消息' })
  @IsString()
  message: string = '';

  @ApiPropertyOptional({ description: '当前画布LogicFlow JSON（含nodes和edges）' })
  @IsOptional()
  lfJson?: Record<string, unknown>;
}

/**
 * BPM Agent Controller.
 *
 * Uses @Post + @Res() (not @Sse) to bypass the global ResponseInterceptor,
 * which would wrap SSE chunks as { code, msg, data } envelopes.
 *
 * BYOC: apiKey / baseUrl / model are passed from the frontend via headers
 * and are NOT persisted server-side.
 *
 * Route: POST /api/v1/bpm/agent/chat
 */
@ApiTags('BPM Agent')
@ApiBearerAuth()
@Controller('bpm/agent')
export class BpmAgentController {
  constructor(private readonly bpmAgentService: BpmAgentService) {}

  @Post('chat')
  @ApiOperation({ summary: 'BPM设计器AI助手(SSE流式; BYOC key经header传入)' })
  async chat(
    @Body() dto: BpmAgentChatBodyDto,
    @Headers('x-api-key') apiKey?: string,
    @Headers('x-base-url') baseUrl?: string,
    @Headers('x-model') model?: string,
    @Res() res?: Response,
    @CurrentUser() user?: { sub: string },
  ): Promise<void> {
    return this.bpmAgentService.streamChatToRes(
      { message: dto.message, lfJson: dto.lfJson as any },
      { apiKey: apiKey ?? '', baseUrl: baseUrl ?? '', model: model ?? '' },
      res!,
      user?.sub,
    );
  }
}
