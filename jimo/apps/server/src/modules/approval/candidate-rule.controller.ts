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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CandidateResolutionService } from './candidate-resolution.service';
import {
  CreateCandidateRuleDto,
  ResolveCandidatesDto,
  UpdateCandidateRuleDto,
} from './dto/candidate-rule.dto';

/**
 * CRUD + resolution for the new Server-side combined-filter Resolution
 * Rules (see CONTEXT.md / ADR-0001..0003). No admin UI yet this phase —
 * rules are configured via this API directly.
 */
@ApiTags('candidate-rules')
@ApiBearerAuth()
@Controller('candidate-rules')
export class CandidateRuleController {
  constructor(private readonly candidateResolution: CandidateResolutionService) {}

  @Get()
  @ApiOperation({ summary: 'List candidate resolution rules' })
  async list() {
    return { code: 0, msg: 'success', data: await this.candidateResolution.listRules() };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a candidate resolution rule' })
  async get(@Param('id') id: string) {
    return { code: 0, msg: 'success', data: await this.candidateResolution.getRuleOrThrow(id) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a candidate resolution rule' })
  async create(@Body() dto: CreateCandidateRuleDto) {
    return { code: 0, msg: 'success', data: await this.candidateResolution.createRule(dto) };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a candidate resolution rule' })
  async update(@Param('id') id: string, @Body() dto: UpdateCandidateRuleDto) {
    return { code: 0, msg: 'success', data: await this.candidateResolution.updateRule(id, dto) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a candidate resolution rule' })
  async remove(@Param('id') id: string) {
    await this.candidateResolution.deleteRule(id);
    return { code: 0, msg: 'success', data: null };
  }

  @Post('resolve')
  @ApiOperation({ summary: 'Resolve the Candidate List for a rule + flow initiator (for a picker UI)' })
  async resolve(@Body() dto: ResolveCandidatesDto) {
    const candidates = await this.candidateResolution.resolveCandidates(dto.ruleId, dto.initiatorUserId);
    return { code: 0, msg: 'success', data: { list: candidates, total: candidates.length } };
  }
}
