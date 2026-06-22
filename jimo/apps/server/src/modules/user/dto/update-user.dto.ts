import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

/**
 * All fields optional. `roleIds` is inherited from CreateUserDto — when present,
 * it full-replaces the user's sys_user_roles (the single source of truth).
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['username', 'password'] as const),
) {}
