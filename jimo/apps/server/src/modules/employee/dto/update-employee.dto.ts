import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsInt, Min, Max } from 'class-validator';

export class UpdateEmployeeDto {
  @ApiPropertyOptional({ description: '工号' })
  @IsOptional()
  @IsString()
  employeeNo?: string;

  @ApiPropertyOptional({ description: '姓名' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '部门 ID' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ description: '职位' })
  @IsOptional()
  @IsString()
  position?: string;

  @ApiPropertyOptional({ description: '电话' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: '邮箱' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ description: '状态: 1=在职 2=离职 3=休假' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  status?: number;

  @ApiPropertyOptional({ description: '入职日期' })
  @IsOptional()
  @IsString()
  entryDate?: string;

  @ApiPropertyOptional({ description: '离职日期' })
  @IsOptional()
  @IsString()
  leaveDate?: string;
}
