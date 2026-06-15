import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ApiTokenService } from './api-token.service';
import { CreateApiTokenDto } from './dto/create-api-token.dto';
import { QueryApiTokenDto } from './dto/query-api-token.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { SysApiToken } from '../../db/schema/api-tokens';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('api-tokens')
@ApiBearerAuth()
@Controller('api-tokens')
export class ApiTokenController {
  constructor(private readonly apiTokenService: ApiTokenService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get paginated list of API tokens' })
  @ApiResponse({ status: 200, description: 'Returns paginated API tokens' })
  async findAll(@Query() query: QueryApiTokenDto): Promise<PaginatedResponse<SysApiToken>> {
    const data = await this.apiTokenService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Generate a new API token' })
  @ApiResponse({ status: 201, description: 'API token generated successfully' })
  async generate(@Body() dto: CreateApiTokenDto): Promise<ApiResp<SysApiToken>> {
    const data = await this.apiTokenService.generate(dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Revoke API token by id' })
  @ApiResponse({ status: 200, description: 'API token revoked successfully' })
  @ApiResponse({ status: 404, description: 'API token not found' })
  async revoke(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.apiTokenService.revoke(id);
    return { code: 0, msg: 'success', data: null };
  }
}
