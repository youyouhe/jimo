import {
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAuthorityBtnDto {
  @ApiProperty({ example: 'uuid-of-role', description: 'Authority (role) ID' })
  @IsNotEmpty()
  @IsUUID('4')
  authorityId: string = '';

  @ApiProperty({ example: 'uuid-of-menu', description: 'Menu ID' })
  @IsNotEmpty()
  @IsUUID('4')
  menuId: string = '';

  @ApiProperty({ example: 'add', maxLength: 64, description: 'Button name/identifier' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(64)
  btnName: string = '';
}
