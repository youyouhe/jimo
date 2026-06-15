import {
  IsNotEmpty,
  IsString,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApiTokenDto {
  @ApiProperty({ example: 'My API Token', maxLength: 128 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  name: string = '';

  @ApiPropertyOptional({ example: '2025-12-31T23:59:59Z', description: 'Expiry date (ISO string)' })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}
