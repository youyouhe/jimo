import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { BpmRulesService } from './bpm-rules.service';
import { UpsertRuleDto } from './dto/upsert-rule.dto';

@ApiTags('BPM Resolution Rules')
@Controller('bpm-rules')
export class BpmRulesController {
  constructor(private readonly bpmRulesService: BpmRulesService) {}

  @Get()
  @ApiOperation({ summary: 'List all resolution rules' })
  async listRules(): Promise<unknown[]> {
    return this.bpmRulesService.listRules();
  }

  @Get(':ruleName')
  @ApiOperation({ summary: 'Get a single resolution rule by name' })
  @ApiParam({ name: 'ruleName', description: 'Rule name identifier' })
  async getRule(@Param('ruleName') ruleName: string): Promise<unknown> {
    return this.bpmRulesService.getRule(ruleName);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new resolution rule' })
  async createRule(@Body() dto: UpsertRuleDto): Promise<unknown> {
    return this.bpmRulesService.createRule(dto);
  }

  @Put(':ruleName')
  @ApiOperation({ summary: 'Update an existing resolution rule' })
  @ApiParam({ name: 'ruleName', description: 'Rule name identifier' })
  async updateRule(
    @Param('ruleName') ruleName: string,
    @Body() dto: UpsertRuleDto,
  ): Promise<unknown> {
    return this.bpmRulesService.updateRule(ruleName, dto);
  }

  @Delete(':ruleName')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a resolution rule' })
  @ApiParam({ name: 'ruleName', description: 'Rule name identifier' })
  async deleteRule(@Param('ruleName') ruleName: string): Promise<void> {
    return this.bpmRulesService.deleteRule(ruleName);
  }
}
