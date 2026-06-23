import { IsBoolean, IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ToggleBtnDto {
  @ApiProperty({ description: 'Role id (authority)' })
  @IsUUID('4')
  roleId!: string;

  @ApiProperty({ description: 'Button sub-menu id (sys_menus row, menu_type=3)' })
  @IsUUID('4')
  buttonMenuId!: string;

  @ApiProperty({ description: 'true = grant, false = revoke' })
  @IsBoolean()
  @IsNotEmpty()
  assigned!: boolean;
}
