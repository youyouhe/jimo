import { IsNotEmpty, IsOptional, IsString, IsBoolean, IsUUID, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAccountDto {
  @ApiProperty({ description: '科目编码（如 1001、1002）', maxLength: 20 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  code: string;

  @ApiProperty({ description: '科目名称', maxLength: 100 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: '科目类型（资产/负债/权益/收入/费用）' })
  @IsNotEmpty()
  @IsString()
  account_type: string;

  @ApiProperty({ description: '余额方向（借方/贷方）' })
  @IsNotEmpty()
  @IsString()
  balance_direction: string;

  @ApiPropertyOptional({ description: '上级科目' })
  @IsOptional()
  @IsUUID()
  parent_id?: string | null | null;

  @ApiPropertyOptional({ description: '备注说明' })
  @IsOptional()
  @IsString()
  description?: string | undefined;

  @ApiProperty({ description: '是否启用' })
  @IsNotEmpty()
  @IsBoolean()
  @Type(() => Boolean)
  is_enabled: boolean;
}
