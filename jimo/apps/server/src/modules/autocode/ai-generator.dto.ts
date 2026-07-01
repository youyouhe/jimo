import { IsArray, IsString, IsIn, IsOptional, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatMessageDto {
  @ApiProperty({ enum: ['user', 'assistant', 'system'] })
  @IsString()
  @IsIn(['user', 'assistant', 'system'])
  role: string = 'user';

  @ApiProperty()
  @IsString()
  content: string = '';
}

export class AiChatContextDto {
  @ApiPropertyOptional({ description: '审批流是否已启用' })
  @IsOptional()
  @IsBoolean()
  approvalEnabled?: boolean;

  @ApiPropertyOptional({ description: '审批链规则名，逗号分隔，如 deptHead,ceo' })
  @IsOptional()
  @IsString()
  approvalChain?: string;

  @ApiPropertyOptional({ enum: ['list', 'document', 'grid', 'calendar'], description: '前端页面类型' })
  @IsOptional()
  @IsIn(['list', 'document', 'grid', 'calendar'])
  pageType?: 'list' | 'document' | 'grid' | 'calendar';

  @ApiPropertyOptional({ enum: ['private', 'department', 'shared', 'public'], description: '数据可见性策略' })
  @IsOptional()
  @IsIn(['private', 'department', 'shared', 'public'])
  visibilityStrategy?: string;
}

export class AiChatRequestDto {
  @ApiProperty({ type: [ChatMessageDto], description: '对话历史(含本轮用户消息)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[] = [];

  @ApiProperty({
    description: 'Optional business entity table name to load entity agent tools (e.g. "companies")',
    required: false,
  })
  @IsOptional()
  @IsString()
  businessType?: string;

  @ApiPropertyOptional({ description: '当前代码生成器配置上下文，帮助 AI 感知外部约束（审批流、页面类型、可见性策略）' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AiChatContextDto)
  context?: AiChatContextDto;
}
