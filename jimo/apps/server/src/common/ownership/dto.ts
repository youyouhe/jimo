import { IsArray, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ShareDto {
  @ApiProperty({ example: 'posts' })
  @IsString()
  @IsNotEmpty()
  businessType!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  businessId!: string;

  @ApiProperty({ type: [String], description: 'sys_user ids to share with (replaces shared_with)' })
  @IsArray()
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class TransferDto {
  @ApiProperty({ example: 'posts' })
  @IsString()
  @IsNotEmpty()
  businessType!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  businessId!: string;

  @ApiProperty()
  @IsUUID('4')
  newOwnerId!: string;
}
