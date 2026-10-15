export type ErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'AUTH_NOT_CONFIGURED'
  | 'AUTH_CALLBACK_FAILED'
  | 'UNAUTHENTICATED'
  | 'GITHUB_API_ERROR'
  | 'CSRF_ORIGIN_REJECTED'
  | 'SNAPSHOT_NOT_FOUND'
  | 'DETECTION_NOT_FOUND'
  | 'DETECTION_STATE_INVALID'
  | 'DETECTION_FAILED'
  | 'DETECTION_CANCELLED'
  | 'NOT_FOUND'
  | 'NOT_READY'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
  };
}

export function errorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
): ApiErrorBody {
  return { error: { code, message, requestId } };
}
