export type ErrorCode =
  | 'CONFIGURATION_ERROR'
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
