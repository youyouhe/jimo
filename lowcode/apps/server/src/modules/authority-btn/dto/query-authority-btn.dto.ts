import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryAuthorityBtnDto {
  @ApiPropertyOptional({ example: 'uuid-of-role', description: 'Filter by authority (role) ID' })
  @IsOptional()
  @IsUUID('4')
  authorityId?: string;

  @ApiPropertyOptional({ example: 'uuid-of-menu', description: 'Filter by menu ID' })
  @IsOptional()
  @IsUUID('4')
  menuId?: string;
}
