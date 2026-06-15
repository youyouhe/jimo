import { IsOptional, IsString, IsNumber, IsUUID, IsArray, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrderDto {
  @ApiPropertyOptional({ description: '名称', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name: string = '';

  @ApiPropertyOptional({ description: '总价' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  price: number = 0;

  @ApiPropertyOptional({ description: '订单明细', type: [Object] })
  @IsOptional()
  @IsArray()
  details: any[] = [];

  @ApiPropertyOptional({ description: '履约', type: [Object] })
  @IsOptional()
  @IsArray()
  performance: any[] = [];
}
