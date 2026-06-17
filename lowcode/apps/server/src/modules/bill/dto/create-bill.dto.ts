import { IsNotEmpty, IsOptional, IsString, IsNumber, IsUUID, IsArray, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBillDto {
  @ApiProperty({ description: '账单编号', maxLength: 50 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  bill_no: string = '';

  @ApiProperty({ description: '账单名称', maxLength: 200 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  bill_name: string = '';

  @ApiProperty({ description: '账单日期' })
  @IsNotEmpty()
  @IsString()
  bill_date: string = '';

  @ApiProperty({ description: '账单总金额' })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  amount: number = 0;

  @ApiProperty({ description: '账单状态' })
  @IsNotEmpty()
  @IsString()
  status: string = '';

  @ApiProperty({ description: '关联项目' })
  @IsNotEmpty()
  @IsUUID()
  project_id: string = '';

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark: string = '';

  @ApiPropertyOptional({ description: '账单明细', type: [Object] })
  @IsOptional()
  @IsArray()
  bill_items: any[] = [];
}
