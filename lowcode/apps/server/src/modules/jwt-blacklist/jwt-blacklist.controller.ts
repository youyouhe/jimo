import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { eq, count } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysJwtBlacklist, SysJwtBlacklist } from '../../db/schema/jwt-blacklist';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('jwt-blacklist')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN)
@Controller('jwt-blacklist')
export class JwtBlacklistController {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of JWT blacklist entries' })
  @ApiResponse({ status: 200, description: 'Returns paginated blacklist' })
  async findAll(@Query() query: PaginationDto): Promise<PaginatedResponse<SysJwtBlacklist>> {
    const { page, pageSize } = query;
    const offset = (page - 1) * pageSize;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysJwtBlacklist)
        .limit(pageSize)
        .offset(offset)
        .orderBy(sysJwtBlacklist.createdAt),
      this.db
        .select({ count: count() })
        .from(sysJwtBlacklist),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { code: 0, msg: 'success', data: { list: rows, total, page, pageSize } };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a JWT blacklist entry by id' })
  @ApiResponse({ status: 200, description: 'Entry removed successfully' })
  @ApiResponse({ status: 404, description: 'Entry not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    const rows = await this.db
      .delete(sysJwtBlacklist)
      .where(eq(sysJwtBlacklist.id, id))
      .returning({ id: sysJwtBlacklist.id });

    if (rows.length === 0) {
      throw new NotFoundException({
        code: 2002,
        message: `JWT blacklist entry with id ${id} not found`,
      });
    }

    return { code: 0, msg: 'success', data: null };
  }
}
