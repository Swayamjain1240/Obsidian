export type ErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'AUTH_NOT_CONFIGURED'
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
