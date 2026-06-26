import { IsNotEmpty, IsOptional, IsString, IsNumber, IsUUID, IsArray, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVoucherDto {
  @ApiProperty({ description: '凭证号（唯一标识，如 J-2024-0001）', maxLength: 50 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  voucher_number!: string;

  @ApiProperty({ description: '凭证日期（业务发生日期）' })
  @IsNotEmpty()
  @IsString()
  voucher_date!: string;

  @ApiProperty({ description: '摘要（凭证业务概述）' })
  @IsNotEmpty()
  @IsString()
  summary!: string;

  @ApiProperty({ description: '凭证状态（草稿/已审核/已过账/作废）' })
  @IsNotEmpty()
  @IsString()
  status!: string;

  @ApiPropertyOptional({ description: '附单据数' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  attachment_count?: number | undefined;

  @ApiPropertyOptional({ description: '凭证明细行', type: [Object] })
  @IsOptional()
  @IsArray()
  items?: any[];
}
