/** Authentication limits shared by the exact Module 2 auth routes and services. */
export const AUTH_LIMITS = {
  EMAIL_MAX_LENGTH: 320,
  PASSWORD_MIN_LENGTH: 12,
  PASSWORD_MAX_LENGTH: 128,
  FAILED_LOGIN_LOCK_THRESHOLD: 5,
  FAILED_LOGIN_LOCK_MINUTES: 15,
} as const;

/** Stable authentication error codes used by the approved auth lifecycle. */
export const AUTH_ERROR_CODE = {
  INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  REGISTRATION_EMAIL_TAKEN: "AUTH_REGISTRATION_EMAIL_TAKEN",
  USER_INACTIVE: "AUTH_USER_INACTIVE",
  USER_LOCKED: "AUTH_USER_LOCKED",
  SESSION_NOT_FOUND: "AUTH_SESSION_NOT_FOUND",
  SESSION_EXPIRED: "AUTH_SESSION_EXPIRED",
  SESSION_REVOKED: "AUTH_SESSION_REVOKED",
  REFRESH_REUSE_DETECTED: "AUTH_REFRESH_REUSE_DETECTED",
} as const;

/** Stable audit event names for the approved authentication actions. */
export const AUTH_AUDIT_EVENT = {
  LOGIN_SUCCEEDED: "auth.login_succeeded",
  LOGIN_FAILED: "auth.login_failed",
  REFRESH_ROTATED: "auth.refresh_rotated",
  REFRESH_REUSE_DETECTED: "auth.refresh_reuse_detected",
  LOGOUT: "auth.logout",
} as const;

/** Reasons written to refresh_sessions.revoke_reason by approved commands. */
export const SESSION_REVOKE_REASON = {
  LOGOUT: "logout",
  ROTATED: "rotated",
  REFRESH_REUSE_DETECTED: "refresh_reuse_detected",
  USER_DEACTIVATED: "user_deactivated",
} as const;

/** Domain events safe for asynchronous downstream consumers. */
export const AUTH_OUTBOX_EVENT = {
  SESSION_REVOKED: "auth.session_revoked",
} as const;
