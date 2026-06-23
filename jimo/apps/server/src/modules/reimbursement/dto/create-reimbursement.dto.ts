import { IsNotEmpty, IsOptional, IsString, IsNumber, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReimbursementDto {
  @ApiProperty({ description: '报销标题', maxLength: 200 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  title: string = '';

  @ApiProperty({ description: '报销类别' })
  @IsNotEmpty()
  @IsString()
  reimbursement_category: string = '';

  @ApiProperty({ description: '报销金额（元）' })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  amount: number = 0;

  @ApiProperty({ description: '报销事由说明' })
  @IsNotEmpty()
  @IsString()
  description: string = '';

  @ApiPropertyOptional({ description: '票据附件（发票、收据等）', maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  attachments: string = '';
}
