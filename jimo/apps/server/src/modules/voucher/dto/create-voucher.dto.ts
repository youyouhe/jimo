import { IsNotEmpty, IsOptional, IsString, IsArray, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVoucherDto {
  @ApiProperty({ description: '凭证号', maxLength: 50 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  voucher_no: string;

  @ApiProperty({ description: '凭证日期' })
  @IsNotEmpty()
  @IsString()
  voucher_date: string;

  @ApiProperty({ description: '凭证摘要' })
  @IsNotEmpty()
  @IsString()
  summary: string;

  @ApiProperty({ description: '制单人', maxLength: 50 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  prepared_by: string;

  @ApiProperty({ description: '凭证状态' })
  @IsNotEmpty()
  @IsString()
  status: string;

  @ApiPropertyOptional({ description: '凭证分录', type: [Object] })
  @IsOptional()
  @IsArray()
  voucher_items?: any[];
}
