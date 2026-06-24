import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OwnershipService } from './ownership.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { ReassignDto, ShareDto, TransferDto } from './dto';

@ApiTags('ownership')
@ApiBearerAuth()
@Controller('ownership')
export class OwnershipController {
  constructor(private readonly ownershipService: OwnershipService) {}

  @Post('share')
  @ApiOperation({ summary: 'Share records with users (batch, owner-only). Replaces shared_with.' })
  async share(@Body() dto: ShareDto, @CurrentUser() user: { sub: string }) {
    const data = await this.ownershipService.share(dto.businessType, dto.businessIds, dto.userIds, user.sub);
    return { code: 0, msg: 'success', data };
  }

  @Post('transfer')
  @ApiOperation({ summary: 'Transfer record ownership to another user (owner-only)' })
  async transfer(@Body() dto: TransferDto, @CurrentUser() user: { sub: string }) {
    const data = await this.ownershipService.transfer(dto.businessType, dto.businessId, dto.newOwnerId, user.sub);
    return { code: 0, msg: 'success', data };
  }

  @Post('reassign')
  @ApiOperation({ summary: 'Reassign records (owner or ownerless) to another user. Batch.' })
  async reassign(@Body() dto: ReassignDto, @CurrentUser() user: { sub: string }) {
    const data = await this.ownershipService.reassign(dto.businessType, dto.ids, dto.newOwnerId, user.sub);
    return { code: 0, msg: 'success', data };
  }
}
