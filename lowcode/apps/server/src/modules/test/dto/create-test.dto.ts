import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTestDto {
  @ApiPropertyOptional({ description: '名称', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name: string = '';

  @ApiPropertyOptional({ description: '描述', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description: string = '';
}
