import { IsNotEmpty, IsOptional, IsString, IsUUID, IsArray, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePolicyDto {
  @ApiProperty({ description: '制度名称', maxLength: 200 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  name: string = '';

  @ApiPropertyOptional({ description: '制度编码', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  policy_code: string = '';

  @ApiPropertyOptional({ description: '制度类型' })
  @IsOptional()
  @IsString()
  policy_type: string = '';

  @ApiPropertyOptional({ description: '版本号', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  version: string = '';

  @ApiPropertyOptional({ description: '制度状态' })
  @IsOptional()
  @IsString()
  status: string = '';

  @ApiPropertyOptional({ description: '所属部门' })
  @IsOptional()
  @IsUUID()
  department_id: string | null = null;

  @ApiPropertyOptional({ description: '生效日期' })
  @IsOptional()
  @IsString()
  effective_date: string = '';

  @ApiPropertyOptional({ description: '失效日期' })
  @IsOptional()
  @IsString()
  expiration_date: string = '';

  @ApiPropertyOptional({ description: '制度描述' })
  @IsOptional()
  @IsString()
  description: string = '';

  @ApiPropertyOptional({ description: '制度明细', type: [Object] })
  @IsOptional()
  @IsArray()
  policy_details: any[] = [];
}
