import { IsArray, IsString, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ChatMessageDto {
  @ApiProperty({ enum: ['user', 'assistant', 'system'] })
  @IsString()
  @IsIn(['user', 'assistant', 'system'])
  role: string = 'user';

  @ApiProperty()
  @IsString()
  content: string = '';
}

export class AiChatRequestDto {
  @ApiProperty({ type: [ChatMessageDto], description: '对话历史(含本轮用户消息)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[] = [];
}
