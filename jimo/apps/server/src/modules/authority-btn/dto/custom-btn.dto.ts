import { IsString, IsArray, IsOptional, ArrayNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCustomBtnDto {
  @ApiProperty({ description: '表名（不含 lc_ 前缀），如 contracts' })
  @IsString()
  tableName: string;

  @ApiProperty({ description: '按钮唯一名称（snake_case），如 view_party_a' })
  @IsString()
  btnName: string;

  @ApiProperty({ description: '按钮显示文字，如 查看甲方' })
  @IsString()
  label: string;

  @ApiProperty({ description: '跳转目标表名（不含 lc_ 前缀），如 companies' })
  @IsString()
  targetTable: string;

  @ApiProperty({ description: '本表上指向目标的字段名，如 party_a_id' })
  @IsString()
  sourceField: string;

  @ApiProperty({ description: '授权的角色 code 数组，如 ["editor","admin"]', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  roles: string[];
}

export class RemoveCustomBtnDto {
  @ApiProperty({ description: '表名（不含 lc_ 前缀）' })
  @IsString()
  tableName: string;

  @ApiProperty({ description: '按钮名称' })
  @IsString()
  btnName: string;
}
