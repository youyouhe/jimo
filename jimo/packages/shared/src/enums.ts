/** User account status. */
export enum UserStatus {
  ACTIVE = 1,
  DISABLED = 2,
}

/** Built-in role codes — stored in sys_roles.code, used as Casbin subject. */
export enum RoleCode {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  EDITOR = 'editor',
  VIEWER = 'viewer',
}

/** Canonical API error codes. */
export const ApiErrorCode = {
  SUCCESS: 0,

  // Auth errors 1xxx
  UNAUTHORIZED: 1001,
  TOKEN_EXPIRED: 1002,
  TOKEN_INVALID: 1003,
  PERMISSION_DENIED: 1005,

  // Validation errors 2xxx
  PARAM_ERROR: 2001,
  RESOURCE_NOT_FOUND: 2002,

  // User-domain errors 3xxx
  USERNAME_EXISTS: 3001,
  PASSWORD_WRONG: 3002,
  USER_DISABLED: 3003,

  // Server errors 5xxx
  INTERNAL_ERROR: 5000,
  DB_ERROR: 5001,
} as const;

export type ApiErrorCodeValue = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
