import {
  Controller,
  Get,
  Post,
  Patch,
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
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { QueryUserDto } from './dto/query-user.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@jimo/shared';
import { SafeUser } from './user.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../core/auth/auth.service';
import { UserRole } from '../../db/schema/users';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of users' })
  @ApiResponse({ status: 200, description: 'Returns paginated users' })
  async findAll(@Query() query: QueryUserDto): Promise<PaginatedResponse<SafeUser>> {
    const data = await this.userService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  // ═══ Literal routes MUST be defined before parameterized :id routes ═══
  // Otherwise NestJS matches /users/profile as :id = "profile" → DB error

  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Returns profile of the authenticated user' })
  async getProfile(
    @CurrentUser() user: JwtPayload,
  ): Promise<ApiResp<SafeUser>> {
    const data = await this.userService.getProfile(user.sub);
    return { code: 0, msg: 'success', data };
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<ApiResp<SafeUser>> {
    const data = await this.userService.updateProfile(user.sub, dto);
    return { code: 0, msg: 'success', data };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change current user password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Old password is incorrect' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<ApiResp<null>> {
    await this.userService.changePassword(user.sub, dto);
    return { code: 0, msg: 'success', data: null };
  }

  // ═══ Parameterized routes ═══

  @Get('options')
  @ApiOperation({ summary: 'List all users as dropdown options' })
  async options() {
    const rows = await this.userService.listOptions();
    return { code: 0, msg: 'success', data: rows };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by id' })
  @ApiResponse({ status: 200, description: 'Returns the user' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SafeUser>> {
    const data = await this.userService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 409, description: 'Username already exists' })
  async create(@Body() dto: CreateUserDto): Promise<ApiResp<SafeUser>> {
    const data = await this.userService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update user by id' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<ApiResp<SafeUser>> {
    const data = await this.userService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Soft delete user by id' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user?: JwtPayload,
  ): Promise<ApiResp<null>> {
    await this.userService.remove(id, user?.sub);
    return { code: 0, msg: 'success', data: null };
  }
}
