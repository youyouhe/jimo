import { IsNotEmpty, IsOptional, IsString, IsUUID, IsArray, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePurchaseOrderDto {
  @ApiProperty({ description: '订单编号', maxLength: 50 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  order_no: string = '';

  @ApiProperty({ description: '供应商' })
  @IsNotEmpty()
  @IsUUID()
  supplier_id: string = '';

  @ApiProperty({ description: '订单日期' })
  @IsNotEmpty()
  @IsString()
  order_date: string = '';

  @ApiProperty({ description: '订单状态' })
  @IsNotEmpty()
  @IsString()
  status: string = '';

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark: string = '';

  @ApiPropertyOptional({ description: '订单明细', type: [Object] })
  @IsOptional()
  @IsArray()
  items: any[] = [];
}
