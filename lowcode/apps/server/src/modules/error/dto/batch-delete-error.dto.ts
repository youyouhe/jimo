import { IsArray, ArrayMinSize, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BatchDeleteErrorDto {
  @ApiProperty({ example: ['uuid1', 'uuid2'], type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  ids: string[] = [];
}
