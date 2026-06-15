import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldP@ssw0rd' })
  @IsNotEmpty()
  @IsString()
  oldPassword: string = '';

  @ApiProperty({ example: 'NewP@ssw0rd', minLength: 6 })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  newPassword: string = '';
}
