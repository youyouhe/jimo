import { IsOptional, IsString, IsUUID, IsArray, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateContractDto {
  @ApiPropertyOptional({ description: '名称', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name: string = '';

  @ApiPropertyOptional({ description: '明细', type: [Object] })
  @IsOptional()
  @IsArray()
  detail: any[] = [];
}
