import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MinioConfigDto {
  @ApiProperty({ example: 'localhost' })
  endpoint: string = '';

  @ApiProperty({ example: 9000 })
  port: number = 9000;

  @ApiProperty({ example: 'minioadmin' })
  accessKey: string = '';

  @ApiProperty({ example: '******' })
  secretKey: string = '';

  @ApiProperty({ example: 'lowcode-dev' })
  bucket: string = '';

  @ApiProperty({ example: false })
  useSSL: boolean = false;
}

export class SaveMinioConfigDto {
  @ApiProperty({ example: 'localhost' })
  @IsString()
  @IsNotEmpty()
  endpoint: string = '';

  @ApiProperty({ example: 9000 })
  @IsInt()
  @Min(1)
  @Max(65535)
  port: number = 9000;

  @ApiProperty({ example: 'minioadmin' })
  @IsString()
  @IsNotEmpty()
  accessKey: string = '';

  @ApiProperty({ example: '******', description: 'Pass "******" to keep existing secret key unchanged' })
  @IsString()
  secretKey: string = '';

  @ApiProperty({ example: 'lowcode-dev' })
  @IsString()
  @IsNotEmpty()
  bucket: string = '';

  @ApiProperty({ example: false })
  @IsBoolean()
  useSSL: boolean = false;
}
