import { IsNotEmpty, IsString, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignRolesDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'Target user ID' })
  @IsNotEmpty()
  @IsString()
  @IsUUID()
  userId: string = '';

  @ApiProperty({
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440001'],
    description: 'Array of role IDs to assign',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  roleIds: string[] = [];
}
