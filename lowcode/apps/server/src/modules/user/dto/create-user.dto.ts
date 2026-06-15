import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEmail,
  IsMobilePhone,
  IsIn,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'john_doe', minLength: 3, maxLength: 64 })
  @IsNotEmpty()
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  username: string = '';

  @ApiProperty({ example: 'StrongP@ss1', minLength: 6 })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password: string = '';

  @ApiProperty({ example: 'John Doe' })
  @IsNotEmpty()
  @IsString()
  nickname!: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+86 13800138000' })
  @IsOptional()
  @IsMobilePhone()
  phone?: string;

  @ApiPropertyOptional({ enum: [1, 2], default: 1 })
  @IsOptional()
  @IsIn([1, 2])
  status?: number = 1;

  @ApiPropertyOptional({
    example: 'viewer',
    enum: ['super_admin', 'admin', 'editor', 'viewer'],
    default: 'viewer',
  })
  @IsOptional()
  @IsString()
  @IsIn(['super_admin', 'admin', 'editor', 'viewer'])
  role?: string = 'viewer';
}
