import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApprovalService } from './approval.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ApproveDto,
  StartApprovalDto,
  UpsertApprovalFlowDto,
} from './dto/approval.dto';

@ApiTags('approvals')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Post('start')
  @ApiOperation({ summary: 'Start approval — chain resolved dynamically from sys_approval_flows + record' })
  async start(
    @Body() dto: StartApprovalDto,
    @CurrentUser() user: { sub: string },
  ) {
    const data = await this.approvalService.startApproval(dto, user.sub);
    return { code: 0, msg: 'success', data };
  }

  @Get('my-tasks')
  @ApiOperation({ summary: 'My pending approval tasks (proxied from BPM)' })
  async myTasks(@CurrentUser() user: { sub: string }) {
    return await this.approvalService.getMyTasks(user.sub);
  }

  @Get('my-initiated')
  @ApiOperation({ summary: 'Approvals I submitted' })
  async myInitiated(@CurrentUser() user: { sub: string }) {
    return { code: 0, msg: 'success', data: await this.approvalService.myInitiated(user.sub) };
  }

  @Get('my-done')
  @ApiOperation({ summary: 'Approval tasks I have already acted on (已办)' })
  async myDone(@CurrentUser() user: { sub: string }) {
    return { code: 0, msg: 'success', data: await this.approvalService.myDoneTasks(user.sub) };
  }

  @Get('finalized')
  @ApiOperation({ summary: 'Finalized (approved/rejected) approvals I am involved in (办结)' })
  async finalized(@CurrentUser() user: { sub: string }) {
    return { code: 0, msg: 'success', data: await this.approvalService.finalized(user.sub) };
  }

  @Get('my-drafts')
  @ApiOperation({ summary: 'My unsubmitted / returned business records (我的起草)' })
  async myDrafts(@CurrentUser() user: { sub: string }) {
    return { code: 0, msg: 'success', data: await this.approvalService.myDrafts(user.sub) };
  }

  @Post(':processInstanceId/approve')
  @ApiOperation({ summary: 'Approve / reject my active task (proxied to BPM)' })
  async approve(
    @Param('processInstanceId') processInstanceId: string,
    @Body() dto: ApproveDto,
    @CurrentUser() user: { sub: string },
  ) {
    return await this.approvalService.approve(processInstanceId, user.sub, dto.approved, dto.comment);
  }
}

@ApiTags('approval-flows')
@ApiBearerAuth()
@Controller('approval-flows')
export class ApprovalFlowController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Get(':businessType')
  @ApiOperation({ summary: 'Get the approval-flow config for a business type' })
  async get(@Param('businessType') businessType: string) {
    const data = await this.approvalService.getFlow(businessType);
    return { code: 0, msg: 'success', data };
  }

  @Post(':businessType')
  @ApiOperation({ summary: 'Create or update the approval-flow config for a business type' })
  async upsert(
    @Param('businessType') businessType: string,
    @Body() dto: UpsertApprovalFlowDto,
  ) {
    const data = await this.approvalService.upsertFlow(businessType, dto);
    return { code: 0, msg: 'success', data };
  }
}
