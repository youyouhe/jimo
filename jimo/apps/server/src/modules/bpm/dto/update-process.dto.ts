import { PartialType } from '@nestjs/swagger';
import { CreateProcessDto } from './create-process.dto';
import { IsOptional, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProcessDto extends PartialType(CreateProcessDto) {
  @ApiPropertyOptional({
    description: 'LogicFlow JSON graph data for the designer canvas. When provided, a new version is auto-created.',
  })
  @IsOptional()
  @IsObject()
  lfJson?: Record<string, unknown>;
}
