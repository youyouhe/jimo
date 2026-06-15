import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from './auth.service';
import { ApiResponse } from '@lowcode/shared';
import { TokenResponseDto } from './dto/token-response.dto';

class RefreshTokenDto {
  refresh_token: string = '';
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  async login(@Body() loginDto: LoginDto): Promise<ApiResponse<TokenResponseDto>> {
    const user = await this.authService.validateUser(
      loginDto.username,
      loginDto.password,
    );
    const tokens = await this.authService.login(user);
    return { code: 0, msg: 'success', data: tokens };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(
    @Body() body: RefreshTokenDto,
  ): Promise<ApiResponse<TokenResponseDto>> {
    const tokens = await this.authService.refreshToken(body.refresh_token);
    return { code: 0, msg: 'success', data: tokens };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user info' })
  async me(@CurrentUser() user: JwtPayload): Promise<ApiResponse<JwtPayload>> {
    return { code: 0, msg: 'success', data: user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout current user' })
  async logout(
    @CurrentUser() user: JwtPayload,
    @Body() body: RefreshTokenDto,
  ): Promise<ApiResponse<{ message: string }>> {
    await this.authService.logout(user.jti, body.refresh_token);
    return { code: 0, msg: 'success', data: { message: 'logged out' } };
  }
}
