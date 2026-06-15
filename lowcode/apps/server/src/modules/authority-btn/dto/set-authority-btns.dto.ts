import {
  IsNotEmpty,
  IsArray,
  IsUUID,
  IsString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetAuthorityBtnsDto {
  @ApiProperty({ example: 'uuid-of-role', description: 'Authority (role) ID' })
  @IsNotEmpty()
  @IsUUID('4')
  authorityId: string = '';

  @ApiProperty({ example: 'uuid-of-menu', description: 'Menu ID' })
  @IsNotEmpty()
  @IsUUID('4')
  menuId: string = '';

  @ApiProperty({ example: ['add', 'edit', 'delete'], type: [String], description: 'List of button names' })
  @IsArray()
  @IsString({ each: true })
  btnNames: string[] = [];
}
