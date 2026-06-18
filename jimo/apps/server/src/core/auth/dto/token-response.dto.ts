import { ApiProperty } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty()
  access_token: string = '';

  @ApiProperty()
  refresh_token: string = '';

  @ApiProperty({ default: 7200 })
  expires_in: number = 7200;
}
