import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRegionDto {
  @ApiProperty({ description: '地区名称', maxLength: 200 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: '地区编码（如行政区划代码）', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string | undefined;

  @ApiPropertyOptional({ description: '上级地区' })
  @IsOptional()
  @IsUUID()
  parent_id?: string | null | null;

  @ApiPropertyOptional({ description: '层级（国家/省/市/区县）', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  level?: string | undefined;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string | undefined;
}
