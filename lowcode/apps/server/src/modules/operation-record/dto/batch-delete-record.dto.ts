import { IsArray, ArrayMinSize, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BatchDeleteRecordDto {
  @ApiProperty({ example: ['uuid1', 'uuid2'], type: [String], description: 'Array of operation record IDs' })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  ids: string[] = [];
}
