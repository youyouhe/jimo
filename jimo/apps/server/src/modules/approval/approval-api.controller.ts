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
    // Return BPM response directly — it's already {code,message,data} envelope.
    // The ResponseInterceptor passes envelopes through unchanged.
    return await this.approvalService.getMyTasks(user.sub);
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
