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

export class SystemAgentChatDto {
  @ApiProperty({ enum: ['users', 'departments', 'employees', 'menus', 'packages', 'roles'], description: 'Which system module to load agent tools for' })
  @IsString()
  @IsIn(['users', 'departments', 'employees', 'menus', 'packages', 'roles'])
  agentType: 'users' | 'departments' | 'employees' | 'menus' | 'packages' | 'roles' = 'users';

  @ApiProperty({ type: [ChatMessageDto], description: 'Conversation history including the latest user message' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[] = [];
}
