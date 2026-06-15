import { IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetRoleMenusDto {
  @ApiProperty({
    description: 'Array of menu IDs to assign to the role (full replacement)',
    type: [String],
    example: ['uuid-1', 'uuid-2'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  menuIds!: string[];
}
