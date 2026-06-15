import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'] as const;

export class CreateApiDto {
  @ApiProperty({ example: 'GET', enum: HTTP_METHODS })
  @IsNotEmpty()
  @IsString()
  @IsIn(HTTP_METHODS)
  method: string = 'GET';

  @ApiProperty({ example: '/api/v1/users', maxLength: 512 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(512)
  path: string = '';

  @ApiPropertyOptional({ example: 'Get paginated user list' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;

  @ApiPropertyOptional({ example: 'User Management' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  apiGroup?: string;

  @ApiPropertyOptional({ example: 'user:query' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  permission?: string;
}
