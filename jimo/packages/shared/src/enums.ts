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

/**
 * Approval lifecycle status for a business record.
 * Stored on `lc_business_approvals.status` and used by both the BPM callback
 * path and the built-in NestJS approval engine.
 */
export enum BusinessApprovalStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PUBLISHED = 'PUBLISHED',
  WITHDRAWN = 'WITHDRAWN',
}

/**
 * Which engine executes the approval flow for a business record.
 * Stored on `lc_business_approvals.executor` to route through the unified
 * ApprovalService facade.
 */
export enum ApprovalExecutor {
  /** Legacy contract flow runs in the external BPM (Flowable) service. */
  BPM = 'bpm',
  /** Low-code tables use the built-in NestJS state machine. */
  NESTJS = 'nestjs',
}
