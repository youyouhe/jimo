import { IsNotEmpty, IsOptional, IsString, IsUUID, IsArray, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVoucherDto {
  @ApiProperty({ description: '凭证号', maxLength: 30 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(30)
  voucher_number: string;

  @ApiProperty({ description: '凭证日期' })
  @IsNotEmpty()
  @IsString()
  voucher_date: string;

  @ApiProperty({ description: '凭证摘要' })
  @IsNotEmpty()
  @IsString()
  summary: string;

  @ApiProperty({ description: '凭证状态' })
  @IsNotEmpty()
  @IsString()
  status: string;

  @ApiPropertyOptional({ description: '附件', maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  attachment?: string | undefined;

  @ApiPropertyOptional({ description: '凭证分录', type: [Object] })
  @IsOptional()
  @IsArray()
  items?: any[];
}
